import { WORKER_BASE as BASE } from './workerBase';

/**
 * 长亭 · 数据层
 *
 * 接口在 `/api/chat/*`（nginx 的 /api/ 去前缀转给 Worker）。同源、cookie 自动带，
 * 所以这里和 `postComments.ts` 一样不手动读 `q_sess`。
 *
 * 和评论数据层最大的不同：**这里是「流」，不是「楼」**。
 *   · history 取一页，poll 取增量
 *   · poll 除了新消息，还要带 `recalled`（被别人撤回/删掉的 id）——
 *     只推增量的话，一条消息被撤回后前端永远不知道，会一直挂在屏幕上
 */

/** 一条消息上的表情回应汇总 */
export interface Reaction {
  /** 表情 key（就是 `:[key]` 里那个 key） */
  emoji: string;
  n: number;
  /** 我自己点没点 */
  mine: boolean;
}

/** 被引用的那条（只带摘要，不带全文） */
export interface Quote {
  id: number;
  name: string;
  excerpt: string;
}

/** 图片 / 视频的元信息 */
export interface ChatMedia {
  id: number;
  kind: 'image' | 'video' | 'file';
  width: number | null;
  height: number | null;
  duration: number | null;
  /** 非空 = 图在 R2（走 CDN 一年缓存）；空 = 早期存在库里的，走 `/api/chat/media/:id` */
  url: string | null;
  /** 只有 kind='file' 才有：原始文件名，下载卡片显示它 */
  filename?: string | null;
  /** 字节数（文件卡片显示大小）；老数据可能没有 */
  bytes?: number | null;
}

/** 库里老数据的地址（R2 的图不走这里） */
export function mediaUrl(id: number): string {
  return `${BASE}/chat/media/${id}`;
}

/** 取真正该用的地址：优先 R2，兜底走 worker */
export function mediaSrc(m: ChatMedia): string {
  return m.url || mediaUrl(m.id);
}

export interface ChatMessage {
  id: number;
  name: string;
  avatar: string;
  /** 站点地址（本地的取账号档案，跨站的取来源站） */
  site: string;
  /** 站长标 */
  admin: boolean;
  body: string;
  /** ISO 字符串 */
  at: string;
  /** pending = 审核中，只有自己看得见；recalled = 已撤回，只留一行提示 */
  status: 'visible' | 'pending' | 'recalled';
  mine: boolean;
  origin: 'local' | 'remote';
  reactions: Reaction[];
  /** 这条在回哪一条（null = 不是回复） */
  quote: Quote | null;
  /** 这条 @ 了我 */
  mentionedMe: boolean;
  /** 最后一次编辑时间（ISO）；null = 没改过 */
  editedAt: string | null;
  /** 图片 / 视频（null = 纯文字） */
  media: ChatMedia | null;
}

export interface ChatPage {
  messages: ChatMessage[];
  hasMore: boolean;
  nextBefore: number;
  /** 我上次读到哪条（0 = 没读过） */
  lastRead: number;
  online: number;
  signedIn: boolean;
  /** 当前置顶 */
  pin: PinInfo | null;
}

export interface PollResult {
  messages: ChatMessage[];
  recalled: number[];
  online: number;
  signedIn: boolean;
  /** 正在打字的人的名字（不含自己） */
  typing: string[];
  /** 我最新一条消息被多少人读到了；null = 我还没发过言 */
  reads: { id: number; n: number } | null;
  /** 当前置顶（每次 poll 都带，站长一改所有人两秒内看见） */
  pin: PinInfo | null;
}

/** 置顶条（没有就是 null） */
export interface PinInfo {
  id: number;
  name: string;
  excerpt: string;
  at: string;
}

const TIMEOUT_POLL = 10_000;
const TIMEOUT_SEND = 15_000;

/** 置顶体解析：字段缺一个就当没有，别让半截数据把横幅画坏 */
function asPin(raw: unknown): PinInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    name: String(r.name ?? ''),
    excerpt: String(r.excerpt ?? ''),
    at: String(r.at ?? ''),
  };
}

function asMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const status = r.status === 'pending' ? 'pending' : r.status === 'recalled' ? 'recalled' : 'visible';
  return {
    id,
    name: String(r.name ?? ''),
    avatar: String(r.avatar ?? ''),
    site: String(r.site ?? ''),
    admin: Boolean(r.admin),
    body: String(r.body ?? ''),
    at: String(r.at ?? ''),
    status,
    mine: Boolean(r.mine),
    origin: r.origin === 'remote' ? 'remote' : 'local',
    reactions: Array.isArray(r.reactions)
      ? (r.reactions as Array<Record<string, unknown>>)
          .map((x) => ({
            emoji: String(x.emoji ?? ''),
            n: Number(x.n) || 0,
            mine: Boolean(x.mine),
          }))
          .filter((x) => x.emoji && x.n > 0)
      : [],
    quote:
      r.quote && typeof r.quote === 'object'
        ? {
            id: Number((r.quote as Record<string, unknown>).id) || 0,
            name: String((r.quote as Record<string, unknown>).name ?? ''),
            excerpt: String((r.quote as Record<string, unknown>).excerpt ?? ''),
          }
        : null,
    mentionedMe: Boolean(r.mentionedMe),
    editedAt: typeof r.editedAt === 'string' && r.editedAt ? r.editedAt : null,
    media:
      r.media && typeof r.media === 'object'
        ? (() => {
            const mm = r.media as Record<string, unknown>;
            const id = Number(mm.id);
            if (!id) return null;
            return {
              id,
              kind:
                mm.kind === 'video' ? ('video' as const) : mm.kind === 'file' ? ('file' as const) : ('image' as const),
              width: Number(mm.width) || null,
              height: Number(mm.height) || null,
              duration: Number(mm.duration) || null,
              url: typeof mm.url === 'string' && mm.url ? mm.url : null,
              filename: typeof mm.filename === 'string' && mm.filename ? mm.filename : null,
              bytes: Number(mm.bytes) || null,
            };
          })()
        : null,
  };
}

export async function loadHistory(opts: { before?: number; limit?: number } = {}): Promise<ChatPage> {
  const qs = new URLSearchParams();
  if (opts.before) qs.set('before', String(opts.before));
  if (opts.limit) qs.set('limit', String(opts.limit));

  const res = await fetch(`${BASE}/chat/history?${qs}`, {
    headers: { accept: 'application/json' },
    credentials: 'include',
    signal: AbortSignal.timeout(TIMEOUT_POLL),
  });
  if (!res.ok) throw new Error(`history ${res.status}`);

  const data = (await res.json()) as {
    messages?: unknown[];
    hasMore?: boolean;
    nextBefore?: number;
    lastRead?: number;
    online?: number;
    pin?: unknown;
    auth?: { signedIn?: boolean };
  };

  return {
    messages: (Array.isArray(data.messages) ? data.messages : [])
      .map(asMessage)
      .filter((m): m is ChatMessage => Boolean(m)),
    hasMore: Boolean(data.hasMore),
    nextBefore: Number(data.nextBefore) || 0,
    lastRead: Number(data.lastRead) || 0,
    online: Number(data.online) || 0,
    signedIn: Boolean(data.auth?.signedIn),
    pin: asPin(data.pin),
  };
}

export async function poll(after: number): Promise<PollResult> {
  const res = await fetch(`${BASE}/chat/poll?after=${after}`, {
    headers: { accept: 'application/json' },
    credentials: 'include',
    signal: AbortSignal.timeout(TIMEOUT_POLL),
  });
  if (!res.ok) throw new Error(`poll ${res.status}`);

  const data = (await res.json()) as {
    messages?: unknown[];
    recalled?: unknown[];
    online?: number;
    typing?: unknown[];
    reads?: { id?: unknown; n?: unknown } | null;
    pin?: unknown;
    auth?: { signedIn?: boolean };
  };

  return {
    messages: (Array.isArray(data.messages) ? data.messages : [])
      .map(asMessage)
      .filter((m): m is ChatMessage => Boolean(m)),
    recalled: (Array.isArray(data.recalled) ? data.recalled : [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0),
    online: Number(data.online) || 0,
    signedIn: Boolean(data.auth?.signedIn),
    pin: asPin(data.pin),
    typing: (Array.isArray(data.typing) ? data.typing : [])
      .map((s) => String(s ?? ''))
      .filter(Boolean)
      .slice(0, 5),
    reads:
      data.reads && Number(data.reads.id) > 0
        ? { id: Number(data.reads.id), n: Number(data.reads.n) || 0 }
        : null,
  };
}

export type SendResult =
  | { ok: true; message: ChatMessage; screened: boolean }
  | { ok: false; reason: 'login' | 'limited' | 'screened' | 'error'; message: string };

export async function send(
  body: string,
  opts: { replyTo?: number; mentions?: number[]; mediaId?: number } = {},
): Promise<SendResult> {
  try {
    const res = await fetch(`${BASE}/chat/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body,
        replyTo: opts.replyTo ?? 0,
        mentions: opts.mentions ?? [],
        mediaId: opts.mediaId ?? 0,
      }),
      credentials: 'include',
      // 带图的消息要先把图传完才发，给足时间
      signal: AbortSignal.timeout(opts.mediaId ? 30_000 : TIMEOUT_SEND),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: unknown;
      screened?: boolean;
      reason?: string;
      // 两种形状：成功时 message 是对象，失败时 message 是字符串
      error?: string;
    };

    if (res.ok) {
      const m = asMessage(data.message);
      if (m) return { ok: true, message: m, screened: Boolean(data.screened) };
      return { ok: false, reason: 'error', message: '这条没能发出去，稍后再试' };
    }

    const text =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : '这条没能发出去，稍后再试';

    if (res.status === 401) return { ok: false, reason: 'login', message: text };
    if (res.status === 429) return { ok: false, reason: 'limited', message: text };
    // 200 + ok:false + reason:'screened' 走的是上面分支；这里兜的是 400 的 too_long 等
    if (data.reason === 'screened') return { ok: false, reason: 'screened', message: text };
    return { ok: false, reason: 'error', message: text };
  } catch {
    return { ok: false, reason: 'error', message: '网络好像不太顺，稍后再试一次' };
  }
}

export async function recall(id: number): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(`${BASE}/chat/${id}/recall`, {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(TIMEOUT_POLL),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, message: data.message || '没能撤回，稍后再试' };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

export type UploadResult = { ok: true; media: ChatMedia } | { ok: false; message: string };

/**
 * 上传图片 / 视频。
 *
 * 走 data URL 而不是 multipart：前端本来就要用 canvas 压图（压完拿到 data URL），
 * 再转一次 Blob 纯属绕路。服务端会自己校验 mime 和大小 —— 客户端的限制永远可绕过。
 */
export async function uploadMedia(
  dataUrl: string,
  meta: { width?: number; height?: number; duration?: number; filename?: string } = {},
): Promise<UploadResult> {
  try {
    const res = await fetch(`${BASE}/chat/media`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: dataUrl,
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        filename: meta.filename,
      }),
      credentials: 'include',
      // 5MB 的视频在慢网络上要传一会儿
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await res.json().catch(() => ({}))) as { media?: ChatMedia; message?: string };
    if (res.ok && data.media) return { ok: true, media: data.media };
    return { ok: false, message: data.message || '没能传上去，稍后再试' };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

/** 报告「正在输入」。失败无声 —— 这个信息可有可无，不该弹任何东西 */
export async function typing(): Promise<void> {
  try {
    await fetch(`${BASE}/chat/typing`, {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(4000),
      keepalive: true,
    });
  } catch {
    /* 静默 */
  }
}

export interface SearchHit {
  id: number;
  name: string;
  avatar: string;
  body: string;
  at: string;
  recalled: boolean;
  mine: boolean;
}

/** 搜聊天记录。至少两个字符，服务端也再判一次 */
export async function search(q: string): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  try {
    const res = await fetch(`${BASE}/chat/search?q=${encodeURIComponent(query)}`, {
      headers: { accept: 'application/json' },
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: SearchHit[] };
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

/**
 * 表情回应（再点一次取消）。
 *
 * 服务端回的是这条消息的**最新汇总**，前端直接替换，不用自己加减 ——
 * 两个人同时点的时候，本地算的数和真实值会分叉。
 */
export async function react(
  id: number,
  emoji: string,
): Promise<{ ok: true; reactions: Reaction[] } | { ok: false; message: string }> {
  try {
    const res = await fetch(`${BASE}/chat/${id}/react`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emoji }),
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      reactions?: Array<Record<string, unknown>>;
      message?: string;
    };
    if (res.ok && Array.isArray(data.reactions)) {
      return {
        ok: true,
        reactions: data.reactions
          .map((x) => ({
            emoji: String(x.emoji ?? ''),
            n: Number(x.n) || 0,
            mine: Boolean(x.mine),
          }))
          .filter((x) => x.emoji && x.n > 0),
      };
    }
    return { ok: false, message: data.message || '没能回应，稍后再试' };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

/** 更新阅读游标。失败无所谓 —— 下次进来顶多是未读线位置偏一点 */
export async function markRead(lastId: number): Promise<void> {
  if (lastId <= 0) return;
  try {
    await fetch(`${BASE}/chat/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastId }),
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
      keepalive: true,
    });
  } catch {
    /* 静默 */
  }
}

// ——————————————————————————————————————————————————————————
// 在线的人
// ——————————————————————————————————————————————————————————

export interface ChatMember {
  id: number;
  name: string;
  avatar: string;
  site: string;
  /** 自己写的一句简介；空串 = 没写 */
  bio?: string;
  admin: boolean;
  online: boolean;
  /** 最后一次在场的时间戳（毫秒）；只有「来过的人」这份名单带 */
  seen?: number;
  /** 在这间屋子里说过多少句；同上，只有 people 带 */
  posts?: number;
  /** 第一句 / 最后一句的时间戳（毫秒）；同上 */
  firstPost?: number;
  lastPost?: number;
}

/** 「空间成员」那张卡要的两份名单：在线的人 + 所有来过的人 */
export interface WhoResult {
  members: ChatMember[];
  people: ChatMember[];
}

/**
 * 在线名单。
 *
 * 和 poll 分开：poll 2.5 秒跑一次，只该拿增量消息；名单 30 秒刷一次就够。
 * 失败了回空数组不抛错 —— 侧栏是锦上添花，不该让聊天室看起来坏了。
 *
 * ⚠️ 这里**没有**「称号 / 经验 / 累计发言」：那一套 2026-11-24 被站长否掉了，
 *    「我是谁」由前端从会话里拿（头像 + 昵称），不必服务端再算一遍。
 */
export async function fetchWho(): Promise<WhoResult> {
  const empty: WhoResult = { members: [], people: [] };
  try {
    const res = await fetch(`${BASE}/chat/who`, {
      headers: { accept: 'application/json' },
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as { members?: ChatMember[]; people?: ChatMember[] };
    const members = Array.isArray(data.members) ? data.members : [];
    return {
      members,
      // 服务端没给 people（老版本 worker / 查询失败）时退回在线名单，卡片不至于空着
      people: Array.isArray(data.people) && data.people.length ? data.people : members,
    };
  } catch {
    return empty;
  }
}

// ——————————————————————————————————————————————————————————
// 编辑 / 举报 / 置顶
// ——————————————————————————————————————————————————————————

export interface EditResult {
  ok: boolean;
  message?: string;
  body?: string;
  editedAt?: string;
}

/**
 * 改自己的话。服务端限 5 分钟、只认本人 —— 前端的按钮显示条件要和它一致，
 * 否则会出现「按钮在、点了报错」。
 */
export async function edit(id: number, body: string): Promise<EditResult> {
  try {
    const res = await fetch(`${BASE}/chat/${id}/edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
      credentials: 'include',
      signal: AbortSignal.timeout(TIMEOUT_SEND),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      body?: string;
      editedAt?: string;
    };
    if (!res.ok || !data.ok) return { ok: false, message: data.message ?? '没改成，稍后再试' };
    return { ok: true, body: String(data.body ?? body), editedAt: String(data.editedAt ?? '') };
  } catch {
    return { ok: false, message: '网络不稳，再试一次' };
  }
}

export interface ReportResult {
  ok: boolean;
  already?: boolean;
  message?: string;
}

/** 举报一条。理由用和审核同一套五类 + other，服务端会校验 */
export async function report(id: number, reason: string): Promise<ReportResult> {
  try {
    const res = await fetch(`${BASE}/chat/${id}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
      credentials: 'include',
      signal: AbortSignal.timeout(TIMEOUT_SEND),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      already?: boolean;
      message?: string;
    };
    if (!res.ok || !data.ok) return { ok: false, message: data.message ?? '没报上去' };
    return { ok: true, already: Boolean(data.already), message: data.message };
  } catch {
    return { ok: false, message: '网络不稳，再试一次' };
  }
}

/** 置顶 / 取消置顶（只有站长能用，服务端把关） */
export async function setPin(id: number | null): Promise<{
  ok: boolean;
  pin?: PinInfo | null;
  message?: string;
}> {
  try {
    const res = await fetch(`${BASE}/chat/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: id ?? 0 }),
      credentials: 'include',
      signal: AbortSignal.timeout(TIMEOUT_SEND),
    });
    const data = (await res.json()) as { ok?: boolean; pin?: unknown; message?: string };
    if (!res.ok || !data.ok) return { ok: false, message: data.message ?? '没置顶成' };
    return { ok: true, pin: asPin(data.pin) };
  } catch {
    return { ok: false, message: '网络不稳，再试一次' };
  }
}
