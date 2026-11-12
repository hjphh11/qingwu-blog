// 清吾 · GitHub OAuth（登录 / 绑定）
//
// 只做一件事：**拿一个已验证的邮箱**，然后交给 anchorLogin 认人 ——
// 认人规则不在这个文件里，否则「GitHub 和邮箱登录变成两个账号」这种 bug 迟早出现。
//
// 回调地址必须与 OAuth App 里登记的完全一致（不能带查询串）：
//   https://www.qingwu.ink/api/auth/github/callback
// 也就是 `SITE_URL` + `/api/auth/github/callback`，换域名要同步改 App 设置。
//
// ⚠️ 访问性：访客浏览器要跳 github.com，国内网络可能不通。所以 GitHub 只是**可选**，
//    邮箱通道永远在第一顺位；服务端换 token 走香港机出口，不受影响。
//
// ⚠️ 只认 `verified` 的邮箱。GitHub 上未验证的邮箱不能当锚点 ——
//    否则谁都能把别人的邮箱挂到自己账上，进而接管那个人的留言。

import type { Env } from '../types';
import { json } from '../util';
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  clearCookieOf,
  cookieOf,
  normalizeEmail,
  randomToken,
  readCookie,
  siteUrl,
} from './common';
import { attachIdentity, createSession, sessionUser } from './store';
import { anchorLogin } from './account';

const STATE_TTL_SEC = 600;

export function githubEnabled(env: Env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

function callbackUrl(env: Env): string {
  return `${siteUrl(env)}/api/auth/github/callback`;
}

/** 回留言板，带一个可读的结果标记 —— 页面按它弹一句提示，不改路由 */
function redirectBack(env: Env, flag: string, cookie?: string): Response {
  const headers: Record<string, string> = {
    location: `${siteUrl(env)}/links/?auth=${encodeURIComponent(flag)}#friends-comments`,
  };
  if (cookie) headers['set-cookie'] = cookie;
  return new Response(null, { status: 302, headers });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const v = (await res.json()) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 发起授权。`bindAccountId` 非空 = 已登录状态下「绑定」，否则是登录 */
export async function githubStart(request: Request, env: Env, bindAccountId?: number): Promise<Response> {
  if (!githubEnabled(env)) {
    return json({ ok: false, reason: 'github_off', message: 'GitHub 登录还没开' }, 503);
  }

  const state = randomToken(16);
  const payload = [state, bindAccountId ? `bind:${bindAccountId}` : 'login'].join('|');

  const target = new URL('https://github.com/login/oauth/authorize');
  target.searchParams.set('client_id', env.GITHUB_CLIENT_ID!);
  target.searchParams.set('redirect_uri', callbackUrl(env));
  target.searchParams.set('scope', 'read:user user:email');
  target.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'set-cookie': cookieOf(request, OAUTH_COOKIE, payload, STATE_TTL_SEC),
      'cache-control': 'no-store',
    },
  });
}

export async function githubCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';

  const raw = readCookie(request, OAUTH_COOKIE);
  const [savedState, mode = 'login'] = raw.split('|');
  // state 一次性：不管成败都清掉，重放无效
  const clear = clearCookieOf(request, OAUTH_COOKIE);

  if (!githubEnabled(env)) return redirectBack(env, 'github_off', clear);
  if (!code || !state || !savedState || state !== savedState) {
    return redirectBack(env, 'state_failed', clear);
  }

  // ① code → token
  let token = '';
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl(env),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    token = String((await readJson(res)).access_token ?? '');
  } catch {
    token = '';
  }
  if (!token) return redirectBack(env, 'token_failed', clear);

  const gh = (path: string) =>
    fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'qingwu-blog-auth',
      },
      signal: AbortSignal.timeout(10_000),
    });

  // ② 用户 + 邮箱
  let uid = '';
  let login = '';
  let name = '';
  let avatar = '';
  let htmlUrl = '';
  let email = '';

  try {
    const u = await readJson(await gh('/user'));
    uid = String(u.id ?? '');
    login = String(u.login ?? '');
    name = String(u.name ?? '') || login;
    avatar = String(u.avatar_url ?? '');
    htmlUrl = String(u.html_url ?? '');

    const emails = await gh('/user/emails');
    if (emails.ok) {
      const list = (await emails.json()) as Array<Record<string, unknown>>;
      if (Array.isArray(list)) {
        const pick =
          list.find((e) => e.primary === true && e.verified === true) ??
          list.find((e) => e.verified === true);
        email = normalizeEmail(pick?.email);
      }
    }
  } catch {
    return redirectBack(env, 'fetch_failed', clear);
  }

  // 没拿到已验证邮箱 ⇒ 不能当锚点，让人改走邮箱验证码
  if (!uid || !email) return redirectBack(env, 'no_email', clear);

  const meta = { login, avatar_url: avatar, html_url: htmlUrl };

  // ③ 绑定模式：必须是当前登录的那个人
  if (mode.startsWith('bind:')) {
    const bindId = Number(mode.slice(5));
    const me = await sessionUser(request, env);
    if (!me || me.account.id !== bindId) return redirectBack(env, 'bind_expired', clear);
    const r = await attachIdentity(env, bindId, 'github', uid, meta);
    return redirectBack(env, r === 'taken' ? 'bind_taken' : 'bind_ok', clear);
  }

  // ④ 登录模式：邮箱锚点
  const anchored = await anchorLogin(env, {
    email,
    provider: 'github',
    uid,
    meta,
    profile: { name, avatar },
  });
  if (!anchored.ok) return redirectBack(env, 'conflict', clear);

  const sessionToken = await createSession(env, request, anchored.account.id, 'visitor');
  return new Response(null, {
    status: 302,
    headers: {
      location: `${siteUrl(env)}/links/?auth=ok#friends-comments`,
      'set-cookie': cookieOf(request, SESSION_COOKIE, sessionToken, SESSION_TTL_SEC),
    },
  });
}
