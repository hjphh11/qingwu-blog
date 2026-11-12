import { avatarFromEmail, emailHash as emailHashOf } from './avatar';
import { WORKER_BASE as BASE } from './workerBase';

/**
 * 友链评论区 · 数据层
 *
 * **已经接上线上 Worker**（api.qingwu.ink 的 /friends-board）：
 *   · 读列表、留言、回复、点赞都走真实接口，数据落 D1
 *   · `FRIENDS_BOARD_DEMO = false`
 *   · 想回到纯前端演示（比如接口挂了临时预览样式），把它改回 true 即可，
 *     组件不用动。
 *
 * 为什么单独抽一层：评论区要的是「公开可读的申请列表」，而现有 Worker 的
 * `GET /apply` 带口令才给数据（里面含访客邮箱，是隐私）。公开读必须走一条
 * **新接口只吐公开字段**（name / url / avatar / intro / created_at），
 * 这件事在预览阶段还没定，所以先把契约钉在这里：
 *
 *   GET  {WORKER}/friends-board        → { ok: true, items: FriendEntry[] }
 *   POST {WORKER}/friends-board        → 复用 /apply 的校验、去重与限流
 *
 * ⚠️ 公开列表里**绝不能有 email**。字段名就叫 email 也一样会漏，
 *    所以这里返回的是单独定义的 `FriendEntry`，不是 `ApiApplication`。
 */

/** 一条公开可见的友链申请 / 留言 */
export interface FriendEntry {
  id: string;
  /** 站点名（也是评论区里的昵称） */
  name: string;
  /** 站点地址 */
  url: string;
  /** 头像直链，可为空 —— 空的时候用站点 favicon 兜底 */
  avatar: string;
  /** 一句介绍 / 留言内容 */
  intro: string;
  /** ISO 时间 */
  at: string;
  /** approved = 已经是友链；pending = 还在等我审 */
  status: 'approved' | 'pending';
  /** 点赞数。演示数据里给几组固定值，真实值接后端后由服务端算 */
  likes?: number;
  /** 楼中楼 —— 只做一层，不嵌套 */
  replies?: FriendReply[];
  /** 邮箱的 MD5 —— 只用于「QQ 头像挂了就换 Cravatar」的兜底，不是邮箱本身 */
  emailHash?: string;
  /** 提交时算好的头像哈希（和 emailHash 同源，留着给老代码用） */
  avatarHash?: string;
  /** 是不是自己发的 —— 登录态下服务端算得出来，未登录恒 false */
  mine?: boolean;
  /** 自己点过赞没有 —— 由服务端给，前台不用再猜 */
  liked?: boolean;
}

/** 一条回复 */
export interface FriendReply {
  id: string;
  name: string;
  /** 被回复的人。渲染成「@名字」，提交时由前端自动填，不用访客自己打 */
  to?: string;
  /** 回复者头像。站长以「爱弥斯」身份回复时会带，普通访客回复没有 */
  avatar?: string;
  /** 头像挂了用它换 Cravatar —— 回复也要有第二档，不能直接掉到首字 */
  emailHash?: string;
  /** 这条回复是在回哪一条（`c-12`）；空 = 回主楼 */
  replyToId?: string;
  /** 回复者填的网址（选填，列表里暂不展示，但存下来备查） */
  url?: string;
  /** 回复者填的邮箱 —— 只给提交用（通知收件人），列表里不会回传 */
  email?: string;
  /**
   * 是否 @ 了主楼作者。
   * false = 访客主动取消了 @，服务端既不在列表里显示「@某某」，也不发通知邮件。
   */
  notify?: boolean;
  intro: string;
  at: string;
}

/**
 * 演示模式开关。
 *
 * false = 走线上 Worker（当前状态）；true = 用本地 DEMO_ENTRIES、什么都不落库。
 * 留着这个开关是为了断网/接口故障时还能预览样式，不是给生产用的。
 */
export const FRIENDS_BOARD_DEMO = false;

/**
 * 留言模板 —— 指引区和评论框的「插入模板」共用这一份。
 *
 * 分成两处写会在改动时漏掉一边（之前友链表单和文档就对不上过），
 * 所以放在数据层，两个组件都从这里取。
 */
export const COMMENT_TEMPLATE = [
  '站点名称：你的站点名称',
  '站点描述：你的站点描述',
  '站点链接：你的站点链接',
  '头像链接：你的站点头像',
  '主页截图：你的主页截图（选填）',
  'RSS 地址：你的 RSS 地址（选填）',
].join('\n');

/**
 * 演示数据。
 *
 * 前三批「已通过」直接取自 `src/data/links.json` 的真实友链，
 * 这样预览时和上面的友链墙是同一批人，看起来不像假数据；
 * 后两条「申请中」是编的占位，用来展示待审核徽章。
 */
export const DEMO_ENTRIES: FriendEntry[] = [
  {
    id: 'demo-1',
    name: '朝朝听雨',
    url: 'http://rainzt.cn',
    avatar: 'https://rainzt.cn/zzty.png',
    intro: '物物而不物于物，念念而不念于念。路过打个招呼，欢迎常来坐坐 ~',
    at: '2026-10-31T09:20:00+08:00',
    status: 'approved',
    likes: 7,
    replies: [
      {
        id: 'demo-1-r1',
        name: '清吾',
        to: '朝朝听雨',
        intro: '欢迎欢迎，已经把你加进友链墙了 ~ 常来坐。',
        at: '2026-10-31T12:40:00+08:00',
      },
    ],
  },
  {
    id: 'demo-2',
    name: '吴彦祖论坛',
    url: 'https://hty.rest',
    // 故意留空：很多申请方不填头像，正好验证首字母兜底的样子
    avatar: '',
    intro: '综合性网站，主要写前端和折腾记录，已经把你加进友链啦。',
    at: '2026-10-30T21:05:00+08:00',
    status: 'approved',
    likes: 3,
  },
  {
    id: 'demo-3',
    name: 'AIOVTUE-雪',
    url: 'https://r2tc.20030327.xyz',
    avatar: 'https://r2tc.20030327.xyz/file/博客/主题/1780655293662_avatar_me.jpg.PNG',
    intro: '一个喜欢拍照和写代码的小站，风格偏安静。申请互换友链 ~',
    at: '2026-10-29T14:42:00+08:00',
    status: 'pending',
    likes: 1,
    replies: [
      {
        id: 'demo-3-r1',
        name: '清吾',
        to: 'AIOVTUE-雪',
        intro: '在看啦，这两天回你 ~',
        at: '2026-10-30T09:02:00+08:00',
      },
    ],
  },
  {
    id: 'demo-4',
    name: '某个路过的旅人',
    url: 'https://example.com',
    avatar: '',
    intro: '不申请友链，只是想说你的站很好看，尤其是开屏那一下。',
    at: '2026-10-28T23:10:00+08:00',
    status: 'pending',
  },
  {
    /* 故意放一条「贴模板」的长留言：6 行、超过折叠阈值，
       用来验证列表里的「展开全文」按钮，也更接近真实场景 */
    id: 'demo-5',
    name: '雾岛来信',
    url: 'https://wudao.example.com',
    avatar: '',
    intro: [
      '站点名称：雾岛来信',
      '站点描述：记录读过的书和看过的电影，偶尔写写前端。',
      '站点链接：https://wudao.example.com',
      '头像链接：https://wudao.example.com/avatar.png',
      '主页截图：（还没做）',
      'RSS 地址：https://wudao.example.com/rss.xml',
    ].join('\n'),
    at: '2026-11-04T10:12:00+08:00',
    status: 'pending',
    likes: 2,
  },
];

/** 域名归一：去掉协议 / www / 路径，用来展示也用来做站内去重 */
export function hostOf(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '');
}

/** 补全协议头：访客填 example.com 也能用 */
export function normalizeUrl(raw: string): string {
  const t = (raw || '').trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/**
 * 把 ISO 时间说成人话。
 *
 * `now` 由调用方传进来（组件里用 effect 拿一次），**不要在这里直接 Date.now()** ——
 * 组件是 SSR + 水合的，服务端与客户端各算一次时间，跨分钟就会水合不匹配。
 */
export function timeAgo(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !now) return '';
  const diff = Math.max(0, now - t);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  // 再久就直接写日期，比「13 个月前」好读
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Worker 的地址 —— 与其他地方同一份（`src/lib/workerBase.ts`）：
 * dev 恒走 `/api`（astro.config 的代理转到 8799），线上走同源。
 */
const WORKER_BASE = BASE;

/** 读公开列表 */
export async function loadFriendEntries(): Promise<FriendEntry[]> {
  if (FRIENDS_BOARD_DEMO) {
    // 演示：假装请求了一次，顺便让加载态有真实的手感
    await new Promise((r) => setTimeout(r, 320));
    return DEMO_ENTRIES;
  }
  const res = await fetch(`${WORKER_BASE}/friends-board`, {
    headers: { accept: 'application/json' },
    credentials: 'include',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`load ${res.status}`);
  const data = (await res.json()) as { items?: FriendEntry[] };
  return Array.isArray(data.items) ? data.items : [];
}

export interface SubmitInput {
  name: string;
  /** 联系邮箱 —— 公开列表里不会出现这个字段 */
  email?: string;
  url: string;
  /** 头像直链 —— 评论框里没有这一格，留空即可（列表会走首字母兜底） */
  avatar?: string;
  intro: string;
}

export type SubmitResult =
  | { ok: true; entry: FriendEntry; deleteToken: string }
  | { ok: false; reason: 'duplicate' | 'limited' | 'unavailable' | 'login' | 'error'; message: string };

/** 提交一条申请 */
export async function submitFriendEntry(input: SubmitInput): Promise<SubmitResult> {
  const url = normalizeUrl(input.url);
  // ⚠️ 兜底要在这里做，不能留到前端渲染时按哈希拼 URL：
  //   哈希只认得出「哪个邮箱」，认不出「这是不是 QQ 邮箱」，
  //   QQ 用户就会看到 Cravatar 的剪影而不是自己的 QQ 头像。
  const avatar = input.avatar ? normalizeUrl(input.avatar) : avatarFromEmail(input.email || '');

  if (FRIENDS_BOARD_DEMO) {
    await new Promise((r) => setTimeout(r, 700));
    return {
      ok: true,
      entry: {
        id: `local-${Date.now()}`,
        name: input.name.trim(),
        url,
        avatar,
        avatarHash: emailHashOf(input.email || ''),
        intro: input.intro.trim(),
        at: new Date().toISOString(),
        status: 'pending',
        emailHash: emailHashOf(input.email || ''),
      },
      // 演示模式也给一个，删除逻辑不用分叉
      deleteToken: emailHashOf(`demo-${Date.now()}`),
    };
  }

  try {
    const res = await fetch(`${WORKER_BASE}/friends-board`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: input.name.trim(),
        email: (input.email || '').trim(),
        url,
        avatar,
        avatarHash: emailHashOf(input.email || ''),
        intro: input.intro.trim(),
      }),
      credentials: 'include',
      signal: AbortSignal.timeout(12000),
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
      return { ok: false, reason: 'duplicate', message: data.message || '这条申请已经在列表里了 ~' };
    }
    if (res.status === 429) {
      return { ok: false, reason: 'limited', message: data.message || '提交得有点频繁，先歇一会儿 ~' };
    }
    if (res.status === 401) {
      // 没登录 / 会话过期 —— 调用方据此把登录弹层打开
      return { ok: false, reason: 'login', message: data.message || '先登录一下再来留言 ~' };
    }
    if (res.status === 503) {
      return { ok: false, reason: 'unavailable', message: data.message || '通道还没开放' };
    }
    return { ok: false, reason: 'error', message: data.message || '这条没能送出去，稍后再试一次' };
  } catch {
    return { ok: false, reason: 'error', message: '网络好像不太顺，稍后再试一次' };
  }
}

/**
 * 本机点过赞的条目（演示阶段用）。
 *
 * 没有服务端就只能记在浏览器里 —— 否则同一条每刷一次都能再点一次，
 * 数字会一路涨，那就等于在骗人。接后端后这份本地记录删掉，
 * 改由接口返回「当前访客是否已赞」。
 */
const LIKE_KEY = 'qingwu:friend-likes';

export function readLiked(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LIKE_KEY) || '[]') as unknown;
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeLiked(ids: string[]): void {
  try {
    localStorage.setItem(LIKE_KEY, JSON.stringify(ids));
  } catch {
    /* 隐私模式写不进去 —— 只是本机不持久，不用打扰访客 */
  }
}

/** 真实接口里 id 形如 `c-12`，取数字部分 */
function numericId(id: string): string {
  return String(id).replace(/^c-/, '');
}

/**
 * 回复某条留言。
 *
 * 后端会把 `to`（被回复的人）记下来，并把邮件发给**那条留言的作者** ——
 * 前提是他留言时填了邮箱；没填就只落库、不发信，也不会报错。
 */
export async function submitReply(
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
  if (FRIENDS_BOARD_DEMO) {
    await new Promise((r) => setTimeout(r, 400));
    return {
      ok: true,
      reply: {
        id: `local-r-${Date.now()}`,
        name: input.name.trim() || '匿名朋友',
        avatar: input.avatar || '',
        url: input.url || '',
        notify: input.notify !== false,
        intro: input.intro.trim(),
        at: new Date().toISOString(),
      },
    };
  }
  try {
    const res = await fetch(`${WORKER_BASE}/friends-board/${numericId(parentId)}/reply`, {
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

/** 点赞 / 取消。真实接口按访客去重，返回最新票数 */
export async function toggleLike(
  id: string,
): Promise<{ ok: true; liked: boolean; likes: number } | { ok: false; message: string }> {
  if (FRIENDS_BOARD_DEMO) {
    await new Promise((r) => setTimeout(r, 220));
    const isLiked = readLiked().includes(id);
    return { ok: true, liked: !isLiked, likes: 0 };
  }
  try {
    const res = await fetch(`${WORKER_BASE}/friends-board/${numericId(id)}/like`, {
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

/* —————————————————————————— 删除自己的留言 —————————————————————————— */

/**
 * 删除凭证只存在**提交者的浏览器**里。
 *
 * 服务端在创建时返回一次 token，列表接口不返回 —— 所以别人拿不到，
 * 只有当时提交的那台设备能删。清缓存/换设备就删不了了，这是没有账号体系的代价。
 */
const TOKEN_KEY = 'qingwu:friend-tokens';

export function readTokens(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && /^[a-f0-9]{32}$/i.test(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveToken(id: string, token: string): void {
  if (!token) return;
  try {
    const all = readTokens();
    all[id] = token;
    localStorage.setItem(TOKEN_KEY, JSON.stringify(all));
  } catch {
    /* 隐私模式写不进去 —— 只是这次会话内删不了，不打扰访客 */
  }
}

export function dropToken(id: string): void {
  try {
    const all = readTokens();
    delete all[id];
    localStorage.setItem(TOKEN_KEY, JSON.stringify(all));
  } catch {
    /* 同上 */
  }
}

/** 删掉自己的一条留言（服务端做软删，status 改成 deleted） */
export async function deleteEntry(
  id: string,
  token: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (FRIENDS_BOARD_DEMO) {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  }
  try {
    const res = await fetch(`${WORKER_BASE}/friends-board/${numericId(id)}`, {
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
