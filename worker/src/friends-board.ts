// 清吾 · 友链评论区（留言 / 回复 / 点赞 / 邮件通知）
//
// 路由：
//   GET  /friends-board                  公开列表（含回复与点赞数，**不含邮箱**）
//   POST /friends-board                  留言（可带站点地址、头像、邮箱）
//   POST /friends-board/:id/reply        回复某条（自动 @ 对方，并邮件通知他）
//   POST /friends-board/:id/like         点赞（同一访客只算一次）
//
// 落库复用 0001 的 `comments` 表（post_slug='friends'，楼中楼用 parent_id），
// 0007 给它补了 email / author_url / avatar 三列，点赞另开 `friend_likes`。
//
// ⚠️ 隐私边界：邮箱只用来发通知，**任何响应里都不会出现它**。
//    下面所有 SELECT 都显式列字段，没有 `SELECT *`。
//
// ⚠️ 发信一律 `ctx.waitUntil`：邮件失败不能把访客的留言卡在 502 上。

import type { Env } from './types';
import { json, originAllowed, parseOrigins } from './util';
import { boardMailText, sendMail } from './mail';

/** 友链评论区在 comments 表里的分区名 */
const SLUG = 'friends';

const LIMITS = { author: 30, url: 300, avatar: 300, body: 300, email: 254 } as const;

/** 同一访客 10 分钟最多 6 条 —— 和 /apply 的 5 条一个量级 */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6;

const URL_RE = /^https?:\/\/[^\s/]+\.[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface CommentRow {
  id: number;
  parent_id: number | null;
  author: string;
  author_url: string | null;
  avatar: string | null;
  body: string;
  status: string;
  ts: number;
}

// ——————————————————————————————————————————————————————————
// 小工具
// ——————————————————————————————————————————————————————————
function withCors(request: Request, env: Env, extra: Record<string, string> = {}) {
  const origin = request.headers.get('origin') || '';
  const headers: Record<string, string> = { 'cache-control': 'no-store', ...extra };
  if (origin && originAllowed(origin, parseOrigins(env.ALLOWED_ORIGINS))) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** 匿名访客标识（IP + UA 哈希截断）—— 点赞去重与限流用，不落明文 */
async function visitorKey(request: Request, env: Env): Promise<string> {
  const data = new TextEncoder().encode(
    `${env.HIT_IP_SALT || 'dev'}|${clientIp(request)}|${request.headers.get('user-agent') || ''}`,
  );
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function normalizeUrl(raw: string): string {
  const t = (raw || '').trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

interface Payload {
  name?: unknown;
  email?: unknown;
  url?: unknown;
  avatar?: unknown;
  intro?: unknown;
}

interface Clean {
  name: string;
  email: string;
  url: string;
  avatar: string;
  intro: string;
}

function validate(body: Payload): { ok: true; v: Clean } | { ok: false; fields: Record<string, string> } {
  const v: Clean = {
    name: String(body.name ?? '').trim(),
    email: String(body.email ?? '').trim(),
    url: body.url ? normalizeUrl(String(body.url)) : '',
    avatar: body.avatar ? normalizeUrl(String(body.avatar)) : '',
    intro: String(body.intro ?? '').trim(),
  };
  const e: Record<string, string> = {};
  if (!v.name) e.name = '请填一下站点名称';
  else if (v.name.length > LIMITS.author) e.name = `名称最多 ${LIMITS.author} 个字`;
  if (!v.intro) e.intro = '内容不能为空';
  else if (v.intro.length > LIMITS.body) e.intro = `内容最多 ${LIMITS.body} 个字`;
  if (v.url && (!URL_RE.test(v.url) || v.url.length > LIMITS.url)) e.url = '网址看起来不太对';
  if (v.avatar && (!URL_RE.test(v.avatar) || v.avatar.length > LIMITS.avatar)) e.avatar = '头像地址看起来不对';
  if (v.email && (!EMAIL_RE.test(v.email) || v.email.length > LIMITS.email)) e.email = '邮箱格式看起来不对';
  return Object.keys(e).length ? { ok: false, fields: e } : { ok: true, v };
}

/** 组装成前端要的公开形状（字段名与 `src/lib/friendsBoard.ts` 的 FriendEntry 对齐） */
function toEntry(row: CommentRow, replies: CommentRow[], likes: number) {
  return {
    id: `c-${row.id}`,
    name: row.author,
    url: row.author_url ?? '',
    avatar: row.avatar ?? '',
    intro: row.body,
    at: new Date(row.ts).toISOString(),
    // 留言默认即时可见；站长在后台改成 pending 就是「等我看看」
    status: row.status === 'pending' ? ('pending' as const) : ('approved' as const),
    likes,
    replies: replies.map((r) => ({
      id: `c-${r.id}`,
      name: r.author,
      to: row.author,
      intro: r.body,
      at: new Date(r.ts).toISOString(),
    })),
  };
}

// ——————————————————————————————————————————————————————————
// GET /friends-board
// ——————————————————————————————————————————————————————————
export async function getFriendsBoard(request: Request, env: Env): Promise<Response> {
  const headers = withCors(request, env);
  try {
    const rows = await env.DB.prepare(
      `SELECT id, parent_id, author, author_url, avatar, body, status, ts
       FROM comments WHERE post_slug = ? AND status != 'deleted'
       ORDER BY ts DESC LIMIT 300`,
    )
      .bind(SLUG)
      .all<CommentRow>();

    const likeRows = await env.DB.prepare(
      'SELECT comment_id, COUNT(*) AS n FROM friend_likes GROUP BY comment_id',
    ).all<{ comment_id: number; n: number }>();

    const likeMap = new Map<number, number>();
    for (const l of likeRows.results ?? []) likeMap.set(l.comment_id, l.n);

    const all = rows.results ?? [];
    const roots = all.filter((r) => r.parent_id === null);
    const byParent = new Map<number, CommentRow[]>();
    for (const r of all) {
      if (r.parent_id === null) continue;
      const list = byParent.get(r.parent_id) ?? [];
      list.push(r);
      byParent.set(r.parent_id, list);
    }

    const items = roots.map((r) =>
      toEntry(
        r,
        // 楼中楼按时间正序，读起来才是对话顺序
        (byParent.get(r.id) ?? []).sort((a, b) => a.ts - b.ts),
        likeMap.get(r.id) ?? 0,
      ),
    );

    return json({ ok: true, items }, 200, headers);
  } catch (err) {
    console.error('[friends-board] 读取失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'storage', message: '列表暂时读不出来' }, 502, headers);
  }
}

// ——————————————————————————————————————————————————————————
// POST /friends-board —— 留言
// ——————————————————————————————————————————————————————————
export async function postFriendsBoard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const headers = withCors(request, env);
  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return json({ ok: false, error: 'bad_request', message: '请求格式不对' }, 400, headers);
  }

  const v = validate(body);
  if (!v.ok) return json({ ok: false, error: 'validation', fields: v.fields }, 400, headers);

  const now = Date.now();
  const key = await visitorKey(request, env);

  // 限流：同一访客 10 分钟最多 6 条
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM comments
     WHERE post_slug = ? AND ip_hash = ? AND ts > ?`,
  )
    .bind(SLUG, key, now - RATE_WINDOW_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_MAX) {
    return json(
      { ok: false, error: 'rate_limited', message: '说得有点频繁，歇一会儿再来 ~' },
      429,
      headers,
    );
  }

  try {
    const res = await env.DB.prepare(
      `INSERT INTO comments (post_slug, parent_id, author, email, author_url, avatar, body, status, ts, ip_hash)
       VALUES (?, NULL, ?, ?, ?, ?, ?, 'visible', ?, ?)`,
    )
      .bind(SLUG, v.v.name, v.v.email || null, v.v.url || null, v.v.avatar || null, v.v.intro, now, key)
      .run();

    const id = Number(res.meta.last_row_id);

    // 通知站长（配了 RESEND_KEY + MAIL_TO 才发）
    if (env.MAIL_TO) {
      ctx.waitUntil(
        sendMail(env, {
          to: env.MAIL_TO,
          subject: `友链评论区 · ${v.v.name}`,
          text: `有人留了言：\n\n${v.v.intro}\n\n站点：${v.v.url || '（没填）'}\n\nhttps://www.qingwu.ink/links/#friends-comments`,
        }),
      );
    }

    return json(
      {
        ok: true,
        entry: {
          id: `c-${id}`,
          name: v.v.name,
          url: v.v.url,
          avatar: v.v.avatar,
          intro: v.v.intro,
          at: new Date(now).toISOString(),
          status: 'approved',
          likes: 0,
          replies: [],
        },
      },
      200,
      headers,
    );
  } catch (err) {
    console.error('[friends-board] 写入失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'storage', message: '这条没能存下来，稍后重试' }, 502, headers);
  }
}

// ——————————————————————————————————————————————————————————
// POST /friends-board/:id/reply —— 回复（自动 @ + 邮件通知）
// ——————————————————————————————————————————————————————————
export async function postFriendReply(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  idParam: string,
): Promise<Response> {
  const headers = withCors(request, env);
  const parentId = Number(idParam);
  if (!Number.isInteger(parentId) || parentId <= 0) {
    return json({ ok: false, error: 'bad_request', message: '找不到这条留言' }, 400, headers);
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return json({ ok: false, error: 'bad_request', message: '请求格式不对' }, 400, headers);
  }

  const v = validate(body);
  if (!v.ok) return json({ ok: false, error: 'validation', fields: v.fields }, 400, headers);

  const now = Date.now();
  const key = await visitorKey(request, env);

  // 只允许回复主楼（不做无限嵌套），并且要能拿到作者邮箱用于通知
  const parent = await env.DB.prepare(
    `SELECT id, author, email FROM comments
     WHERE id = ? AND post_slug = ? AND parent_id IS NULL AND status != 'deleted'`,
  )
    .bind(parentId, SLUG)
    .first<{ id: number; author: string; email: string | null }>();

  if (!parent) {
    return json({ ok: false, error: 'not_found', message: '这条留言已经不在了' }, 404, headers);
  }

  try {
    const res = await env.DB.prepare(
      `INSERT INTO comments (post_slug, parent_id, author, email, body, status, ts, ip_hash)
       VALUES (?, ?, ?, ?, ?, 'visible', ?, ?)`,
    )
      .bind(SLUG, parentId, v.v.name, v.v.email || null, v.v.intro, now, key)
      .run();

    // 通知被回复的人：他自己的留言里填过邮箱才发。
    // 站长回复时不抄送自己，避免每回一句都收到一封信。
    if (parent.email) {
      ctx.waitUntil(
        sendMail(env, {
          to: parent.email,
          subject: `清吾 回复了你在友链评论区的留言`,
          text: boardMailText({
            kind: 'reply',
            from: v.v.name,
            toName: parent.author,
            body: v.v.intro,
            site: v.v.url,
          }),
        }),
      );
    }

    return json(
      {
        ok: true,
        reply: {
          id: `c-${Number(res.meta.last_row_id)}`,
          name: v.v.name,
          to: parent.author,
          intro: v.v.intro,
          at: new Date(now).toISOString(),
        },
      },
      200,
      headers,
    );
  } catch (err) {
    console.error('[friends-board] 回复失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'storage', message: '回复没能存下来，稍后重试' }, 502, headers);
  }
}

// ——————————————————————————————————————————————————————————
// POST /friends-board/:id/like —— 点赞（按访客去重，可取消）
// ——————————————————————————————————————————————————————————
export async function postFriendLike(
  request: Request,
  env: Env,
  idParam: string,
): Promise<Response> {
  const headers = withCors(request, env);
  const commentId = Number(idParam);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    return json({ ok: false, error: 'bad_request' }, 400, headers);
  }

  const key = await visitorKey(request, env);

  try {
    const existing = await env.DB.prepare(
      'SELECT 1 AS x FROM friend_likes WHERE comment_id = ? AND visitor = ?',
    )
      .bind(commentId, key)
      .first<{ x: number }>();

    if (existing) {
      await env.DB.prepare('DELETE FROM friend_likes WHERE comment_id = ? AND visitor = ?')
        .bind(commentId, key)
        .run();
    } else {
      await env.DB.prepare('INSERT OR IGNORE INTO friend_likes (comment_id, visitor, ts) VALUES (?, ?, ?)')
        .bind(commentId, key, Date.now())
        .run();
    }

    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM friend_likes WHERE comment_id = ?')
      .bind(commentId)
      .first<{ n: number }>();

    return json({ ok: true, liked: !existing, likes: cnt?.n ?? 0 }, 200, headers);
  } catch (err) {
    console.error('[friends-board] 点赞失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'storage' }, 502, headers);
  }
}
