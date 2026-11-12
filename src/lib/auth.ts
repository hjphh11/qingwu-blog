/**
 * 清吾 · 统一身份（前端数据层）
 *
 * 接口都在 `/api/auth/*`（nginx 的 /api/ 去前缀转发到 Worker 的 /auth/*）。
 * 生产构建把 `PUBLIC_HIT_WORKER_URL` 设成 `/api`，所以**同源**——
 * 会话 cookie（`q_sess`，HttpOnly）会自动随请求带上，这里不用手动读它。
 *
 * ⚠️ 跨源直连 Worker（PUBLIC_HIT_WORKER_URL=https://api.qingwu.ink）时 cookie 不会带上，
 *    表现为「登录成功但马上又变成未登录」。那是构建参数问题，不是这里的问题。
 */

const BASE = (import.meta.env.PUBLIC_HIT_WORKER_URL || 'https://api.qingwu.ink').replace(/\/$/, '');

export interface Identity {
  provider: 'email' | 'github';
  /** 邮箱打码 / GitHub 登录名 */
  label: string;
  removable: boolean;
}

export interface SessionAccount {
  id: number;
  name: string;
  /** 已打码，原文不出网 */
  email: string;
  emailHash: string;
  avatar: string;
  site: string;
  role: 'visitor' | 'admin';
  since: number;
  identities: Identity[];
}

export interface AuthConfig {
  /** 未登录能不能留言。true = 只能读 */
  requireLogin: boolean;
  /** 有没有配 GitHub OAuth */
  github: boolean;
}

export const DEFAULT_CONFIG: AuthConfig = { requireLogin: true, github: false };

interface MeResponse {
  ok?: boolean;
  account?: SessionAccount | null;
  config?: AuthConfig;
}

/** 当前账号 + 站点配置。前台只调这一个就知道该画什么。 */
export async function fetchMe(): Promise<{ account: SessionAccount | null; config: AuthConfig }> {
  try {
    const res = await fetch(`${BASE}/auth/me`, {
      headers: { accept: 'application/json' },
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { account: null, config: DEFAULT_CONFIG };
    const data = (await res.json()) as MeResponse;
    return {
      account: data.account ?? null,
      config: { ...DEFAULT_CONFIG, ...(data.config ?? {}) },
    };
  } catch {
    // 接口不通时按「必须登录 + 无 GitHub」处理：至少不会让人白填一屏再报错
    return { account: null, config: DEFAULT_CONFIG };
  }
}

type Result<T> = ({ ok: true } & T) | { ok: false; message: string; retryAfter?: number; cooldown?: number };

/** 发验证码。**无论邮箱是否注册过，回答都一样** —— 首次登录即注册 */
export async function startEmailLogin(rawEmail: string): Promise<Result<{ cooldown?: number }>> {
  try {
    const res = await fetch(`${BASE}/auth/email/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: rawEmail.trim() }),
      credentials: 'include',
      signal: AbortSignal.timeout(12000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      retryAfter?: number;
    };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, message: data.message || '验证码没发出去，稍后再试', retryAfter: data.retryAfter };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

/** 验码登录（首次会自动建号，并把同邮箱的历史留言归到这个账号下） */
export async function verifyEmailLogin(
  rawEmail: string,
  code: string,
): Promise<Result<{ account: SessionAccount; config: AuthConfig; created?: boolean }>> {
  try {
    const res = await fetch(`${BASE}/auth/email/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: rawEmail.trim(), code: code.trim() }),
      credentials: 'include',
      signal: AbortSignal.timeout(12000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      account?: SessionAccount;
      config?: AuthConfig;
      created?: boolean;
    };
    if (res.ok && data.ok && data.account) {
      return {
        ok: true,
        account: data.account,
        config: { ...DEFAULT_CONFIG, ...(data.config ?? {}) },
        created: data.created,
      };
    }
    return { ok: false, message: data.message || '验证码不对，再看看？' };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* 退不出去也只是前端先当已退出，下次刷新会自愈 */
  }
}

/** 改默认署名 / 站点 / 头像。之后的留言都按这份算 */
export async function saveProfile(input: {
  display_name: string;
  site_url: string;
  avatar_url?: string;
}): Promise<Result<{ account: SessionAccount | null }>> {
  try {
    const res = await fetch(`${BASE}/auth/profile`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      account?: SessionAccount | null;
    };
    if (res.ok && data.ok) return { ok: true, account: data.account ?? null };
    return { ok: false, message: data.message || '没存上，稍后再试' };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

export interface MyComment {
  id: string;
  intro: string;
  status: 'approved' | 'pending';
  at: string;
  likes: number;
}

export async function fetchMyComments(): Promise<MyComment[]> {
  try {
    const res = await fetch(`${BASE}/auth/my-comments`, {
      headers: { accept: 'application/json' },
      credentials: 'include',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: MyComment[] };
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/** 解绑某个登录方式（邮箱是锚点，服务端会拒绝） */
export async function unbindIdentity(provider: string): Promise<Result<{ account: SessionAccount | null }>> {
  try {
    const res = await fetch(`${BASE}/auth/identities/${provider}`, {
      method: 'DELETE',
      credentials: 'include',
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      account?: SessionAccount | null;
    };
    if (res.ok && data.ok) return { ok: true, account: data.account ?? null };
    return { ok: false, message: data.message || '没能解绑' };
  } catch {
    return { ok: false, message: '网络好像不太顺，稍后再试一次' };
  }
}

/** GitHub 登录是整页跳转（回调会 302 回 /links/），所以这里只给地址 */
export function githubLoginUrl(): string {
  return `${BASE}/auth/github/start`;
}

/**
 * 读走 `?auth=xxx` 并把它从地址栏抹掉。
 *
 * GitHub 回调带回来的结果标记（ok / no_email / bind_taken…）只在这一次有用，
 * 留着会让刷新时重复弹提示，也让分享出去的链接带着别人的状态。
 */
export function consumeAuthFlag(): string {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(window.location.href);
    const flag = url.searchParams.get('auth') || '';
    if (!flag) return '';
    url.searchParams.delete('auth');
    window.history.replaceState({}, '', url.toString());
    return flag;
  } catch {
    return '';
  }
}

/** 把回调标记翻译成一句人话 */
export function authFlagText(flag: string): { kind: 'ok' | 'warn'; text: string } | null {
  switch (flag) {
    case 'ok':
      return { kind: 'ok', text: '登录好了，这回不用再填名字和邮箱了 ~' };
    case 'bind_ok':
      return { kind: 'ok', text: 'GitHub 已经绑到这个账号上了。' };
    case 'bind_taken':
      return { kind: 'warn', text: '这个 GitHub 已经绑在另一个账号上了。' };
    case 'bind_expired':
      return { kind: 'warn', text: '绑定超时了，重新点一次「绑定 GitHub」。' };
    case 'no_email':
      return {
        kind: 'warn',
        text: 'GitHub 没给出已验证的邮箱，没法当身份用 —— 用邮箱验证码登录吧。',
      };
    case 'conflict':
      return { kind: 'warn', text: '这个邮箱已经被别的登录方式占用了，先联系站长。' };
    case 'state_failed':
    case 'token_failed':
    case 'fetch_failed':
      return { kind: 'warn', text: 'GitHub 那边没走通，稍后再试，或者用邮箱登录。' };
    case 'github_off':
      return { kind: 'warn', text: 'GitHub 登录还没开。' };
    default:
      return null;
  }
}
