import { WORKER_BASE as BASE } from './workerBase';
import { avatarFromEmail, emailHash as emailHashOf } from './avatar';
import { dropToken, readTokens, saveToken, type BoardPage, type FriendEntry, type FriendReply, type SubmitInput, type SubmitResult } from './friendsBoard';

/**
 * 文章评论 · 数据层
 *
 * 和友链留言板（`src/lib/friendsBoard.ts`）是**同一套后端**：同一条 `comments` 表、
 * 同一套统一身份（邮箱验证码 / GitHub）、同一个 `REQUIRE_LOGIN` 开关、同一张点赞表。
 * 差别只有分区名 —— 这里一篇文章一个分区，`post_slug = '/blog/<slug>'`。
 *
 * 接口（`worker/src/post-comments.ts`）：
 *   GET    /post-comments?path=/blog/<slug>[&before=<ts>&limit=20]
 *   POST   /post-comments
 *   POST   /post-comments/:id/reply
 *   POST   /post-comments/:id/like
 *   DELETE /post-comments/:id
 *
 * ⚠️ 删除凭证与留言板**共用一份 localStorage**（`qingwu:friend-tokens`）：
 *    同一个人在两处留下的凭证没必要分两个桶，而且旧数据不用迁移。
 */

/** 把路径收敛成 `/blog/<slug>`（去掉结尾斜杠，和服务端 normalizePath 一致） */
function cleanPath(path: string): string {
  return (path || '').trim().replace(/\/+$/, '');
}

/** 真实接口里 id 形如 `c-12`，取数字部分 */
function numericId(id: string): string {
  return String(id).replace(/^c-/, '');
}

export async function loadPostComments(
  path: string,
  opts: { before?: number; limit?: number } = {},
): Promise<BoardPage> {
  const qs = new URLSearchParams({ path: cleanPath(path) });
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.before) qs.set('before', String(opts.before));

  const res = await fetch(`${BASE}/post-comments?${qs}`, {
    headers: { accept: 'application/json' },
    credentials: 'include',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`load ${res.status}`);

  const data = (await res.json()) as {
    items?: FriendEntry[];
    hasMore?: boolean;
    nextBefore?: number;
    auth?: { requireLogin?: boolean; signedIn?: boolean };
  };

  return {
    items: Array.isArray(data.items) ? data.items : [],
    hasMore: Boolean(data.hasMore),
    nextBefore: Number(data.nextBefore) || 0,
    requireLogin: Boolean(data.auth?.requireLogin),
    signedIn: Boolean(data.auth?.signedIn),
  };
}

/**
 * 发一条评论。
 *
 * 错误分支与留言板逐条对应（409 重复 / 429 太频繁 / 401 要登录 / 503 通道未开），
 * 前端据此决定是提示一句还是直接把登录弹层打开。
 */
export async function submitPostComment(path: string, input: SubmitInput): Promise<SubmitResult> {
  try {
    const res = await fetch(`${BASE}/post-comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: cleanPath(path),
        // 登录时这三格不显示，传空串即可 —— 服务端一律以账号档案为准
        name: input.name.trim(),
        email: (input.email || '').trim(),
        url: (input.url || '').trim(),
        // 未登录也能有头像：按邮箱算 QQ / Cravatar 那张（和留言板同一套）。
        // 邮箱本身只用来算哈希，服务端不会把它回给任何人。
        avatar: avatarFromEmail((input.email || '').trim()),
        avatarHash: emailHashOf((input.email || '').trim()),
        intro: input.intro.trim(),
      }),
      credentials: 'include',
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      entry?: FriendEntry;
      deleteToken?: string;
    };
    if (res.ok && data.entry) {
      return { ok: true, entry: data.entry, deleteToken: String(data.deleteToken ?? '') };
    }
    if (res.status === 409) {
      return { ok: false, reason: 'duplicate', message: data.message || '这条已经发过了 ~' };
    }
    if (res.status === 429) {
      return { ok: false, reason: 'limited', message: data.message || '说得有点频繁，先歇一会儿 ~' };
    }
    if (res.status === 401) {
      return { ok: false, reason: 'login', message: data.message || '先登录一下再来 ~' };
    }
    if (res.status === 503) {
      return { ok: false, reason: 'unavailable', message: data.message || '通道还没开放' };
    }
    return { ok: false, reason: 'error', message: data.message || '这条没能送出去，稍后再试一次' };
  } catch {
    return { ok: false, reason: 'error', message: '网络好像不太顺，稍后再试一次' };
  }
}

export async function submitPostReply(
  parentId: string,
  input: {
    name: string;
    email?: string;
    url?: string;
    intro: string;
    avatar?: string;
    /** false = 取消 @，不发通知邮件 */
    notify?: boolean;
    /** 在回哪一条回复（`c-12`）。不带 = 回主楼 */
    replyTo?: string;
  },
): Promise<{ ok: true; reply: FriendReply } | { ok: false; message: string }> {
  try {
    const res = await fetch(`${BASE}/post-comments/${numericId(parentId)}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: input.name.trim(),
        email: (input.email || '').trim(),
        url: (input.url || '').trim(),
        avatar: input.avatar || '',
        notify: input.notify !== false,
        // 只认 `c-12` 里的数字；服务端还要校验它是不是同一栋楼里的回复
        replyTo: numericId(input.replyTo || '') || 0,
        intro: input.intro.trim(),
      }),
      credentials: 'include',
      signal: AbortSignal.timeout(12000),
    });
    const data = (await res.json().catch(() => ({}))) as { reply?: FriendReply; message?: string };
    if (res.ok && data.reply) return { ok: true, reply: data.reply };
    return { ok: false, message: data.message || '回复没能发出去，稍后再试' };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

export async function togglePostLike(
  id: string,
): Promise<{ ok: true; liked: boolean; likes: number } | { ok: false; message: string }> {
  try {
    const res = await fetch(`${BASE}/post-comments/${numericId(id)}/like`, {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      liked?: boolean;
      likes?: number;
      message?: string;
    };
    if (res.ok && typeof data.likes === 'number') {
      return { ok: true, liked: Boolean(data.liked), likes: data.likes };
    }
    return { ok: false, message: data.message || '点赞没成功，稍后再试' };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

export async function deletePostComment(
  id: string,
  token: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(`${BASE}/post-comments/${numericId(id)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'include',
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, message: data.message || '没能删掉，稍后再试' };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

/** 删除凭证（与留言板共用一份存储；这里只是给组件一个语义清楚的名字） */
export { dropToken, readTokens, saveToken };
