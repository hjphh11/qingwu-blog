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
}

export interface ChatPage {
  messages: ChatMessage[];
  hasMore: boolean;
  nextBefore: number;
  /** 我上次读到哪条（0 = 没读过） */
  lastRead: number;
  online: number;
  signedIn: boolean;
}

export interface PollResult {
  messages: ChatMessage[];
  recalled: number[];
  online: number;
  signedIn: boolean;
}

const TIMEOUT_POLL = 10_000;
const TIMEOUT_SEND = 15_000;

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
  };
}

export type SendResult =
  | { ok: true; message: ChatMessage; screened: boolean }
  | { ok: false; reason: 'login' | 'limited' | 'screened' | 'error'; message: string };

export async function send(body: string): Promise<SendResult> {
  try {
    const res = await fetch(`${BASE}/chat/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
      credentials: 'include',
      signal: AbortSignal.timeout(TIMEOUT_SEND),
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
