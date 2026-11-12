// 清吾 · 统一身份路由
//
// 对外全部是 `/api/auth/*`（nginx 的 location /api/ 去前缀转发到 Worker 的 /auth/*），
// **nginx 一行都不用改** —— 因为带 Basic Auth 的只有 /api/admin/。
//
// 认证边界：
//   · 这里只管「谁在说话」，不管「能不能说话」—— 留言的拦截在 friends-board.ts
//   · 邮箱原文永不出网，`/auth/me` 只回打码后的 `145****@qq.com`
//   · 所有写接口都发 no-store，别让 CDN / 浏览器缓存住会话相关响应

import type { Env } from '../types';
import { json } from '../util';
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  clearCookieOf,
  cookieOf,
  corsHeaders,
  isOn,
} from './common';
import { sendLoginCode, verifyLoginCode } from './codes';
import { anchorLogin, claimComments, publicAccount } from './account';
import {
  createSession,
  destroySession,
  findAccountById,
  listIdentities,
  removeIdentity,
  sessionUser,
} from './store';
import { githubCallback, githubEnabled, githubStart } from './github';
import { clearAvatar, getAvatar, putAvatar } from './avatar-store';

const NAME_MAX = 30;
const URL_MAX = 300;

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const v = (await request.json()) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

function normalizeUrl(raw: string): string {
  const t = (raw || '').trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function configOf(env: Env) {
  return {
    requireLogin: isOn(env.REQUIRE_LOGIN),
    github: githubEnabled(env),
  };
}

/** 当前账号 + 站点配置。前台只调这一个接口就知道该画什么。 */
async function getMe(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  const me = await sessionUser(request, env);
  return json(
    {
      ok: true,
      account: me ? await publicAccount(env, me.account) : null,
      kind: me?.kind ?? null,
      config: configOf(env),
    },
    200,
    headers,
  );
}

async function postEmailStart(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  const body = await readJson(request);
  const r = await sendLoginCode(env, request, body.email, 'login');
  if (!r.ok) {
    const status = r.reason === 'locked' ? 429 : r.reason === 'cooldown' ? 429 : 400;
    return json({ ok: false, reason: r.reason, message: r.message, retryAfter: r.retryAfter }, status, headers);
  }
  // ⚠️ 文案不暗示邮箱是否注册过 —— 首次登录即注册，两条路长得一样
  return json(
    {
      ok: true,
      message: '如果这个邮箱能收信，验证码已经在路上了',
      // 仅本地预览（AUTH_DEV_CODE=1 + 回环地址）才有；线上恒为 undefined
      devCode: r.devCode,
    },
    200,
    headers,
  );
}

async function postEmailVerify(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  const body = await readJson(request);
  const v = await verifyLoginCode(env, request, body.email, body.code, 'login');
  if (!v.ok) {
    const status = v.reason === 'locked' ? 429 : 401;
    return json({ ok: false, reason: v.reason, message: v.message, left: v.left }, status, headers);
  }

  const anchored = await anchorLogin(env, {
    email: v.email,
    provider: 'email',
    uid: v.email,
    profile: {},
  });
  if (!anchored.ok) {
    return json({ ok: false, reason: 'conflict', message: '这个邮箱和已有的登录方式冲突了，先联系站长' }, 409, headers);
  }
  if (anchored.account.status !== 'active') {
    return json({ ok: false, reason: 'disabled', message: '这个账号现在不能发言' }, 403, headers);
  }

  const token = await createSession(env, request, anchored.account.id, 'visitor');
  return json(
    {
      ok: true,
      account: await publicAccount(env, anchored.account),
      created: anchored.created,
      config: configOf(env),
    },
    200,
    { ...headers, 'set-cookie': cookieOf(request, SESSION_COOKIE, token, SESSION_TTL_SEC) },
  );
}

async function postLogout(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  await destroySession(request, env);
  return json({ ok: true }, 200, {
    ...headers,
    'set-cookie': clearCookieOf(request, SESSION_COOKIE),
  });
}

async function patchProfile(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  const me = await sessionUser(request, env);
  if (!me) return json({ ok: false, reason: 'unauthorized' }, 401, headers);

  const body = await readJson(request);
  const name = str(body.display_name, NAME_MAX);
  const site = normalizeUrl(str(body.site_url, URL_MAX));

  if (site && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(site)) {
    return json({ ok: false, reason: 'bad_site', message: '站点网址看起来不太对' }, 400, headers);
  }

  // 头像走独立接口（上传见 postAvatar）—— 这里**不碰** avatar_url。
  // 曾经把「署名 + 站点 + 头像」写进同一个 UPDATE，结果「只改署名」也会把
  // 头像一起覆盖掉；分开之后各自说得清。
  await env.DB.prepare('UPDATE accounts SET display_name = ?, site_url = ? WHERE id = ?')
    .bind(name || null, site || null, me.account.id)
    .run();

  const fresh = await findAccountById(env, me.account.id);
  return json({ ok: true, account: fresh ? await publicAccount(env, fresh) : null }, 200, headers);
}

/**
 * 上传头像。前端已经压成 160×160 的 webp（十 KB 级），这里只做格式与尺寸的复核。
 *
 * 图不进 `accounts.avatar_url`，而是 `account_avatars` 表 + 一个短地址 ——
 * 理由见 `0024_account_avatars.sql` 顶部：留言会快照头像，十几 KB 的 data URL
 * 复制进每一条留言，列表响应会爆。
 */
async function postAvatar(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  const me = await sessionUser(request, env);
  if (!me) return json({ ok: false, reason: 'unauthorized' }, 401, headers);

  const body = await readJson(request);
  const r = await putAvatar(env, me.account.id, String(body.data ?? ''));
  if (!r.ok) return json({ ok: false, reason: r.reason, message: r.message }, 400, headers);

  const fresh = await findAccountById(env, me.account.id);
  return json({ ok: true, account: fresh ? await publicAccount(env, fresh) : null }, 200, headers);
}

/** 删掉上传的头像 → 回落到按邮箱算的那张（QQ 邮箱就是 QQ 头像） */
async function deleteAvatar(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  const me = await sessionUser(request, env);
  if (!me) return json({ ok: false, reason: 'unauthorized' }, 401, headers);

  await clearAvatar(env, me.account.id);
  const fresh = await findAccountById(env, me.account.id);
  return json({ ok: true, account: fresh ? await publicAccount(env, fresh) : null }, 200, headers);
}

async function getMyComments(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  const me = await sessionUser(request, env);
  if (!me) return json({ ok: false, reason: 'unauthorized' }, 401, headers);

  // 读之前再认领一次。登录那一刻已经认领过，但用户可能「登录着，却在另一台设备
  // 用未登录状态留了言」—— 那种情况不会再触发登录，只能在这里补。
  await claimComments(env, me.account);

  const rows = await env.DB.prepare(
    `SELECT c.id, c.body, c.status, c.ts,
            (SELECT COUNT(*) FROM friend_likes l WHERE l.comment_id = c.id) AS likes
       FROM comments c
      WHERE c.post_slug = 'friends' AND c.account_id = ? AND c.parent_id IS NULL AND c.status != 'deleted'
      ORDER BY c.ts DESC LIMIT 50`,
  )
    .bind(me.account.id)
    .all<{ id: number; body: string; status: string; ts: number; likes: number }>();

  return json(
    {
      ok: true,
      items: (rows.results ?? []).map((r) => ({
        id: `c-${r.id}`,
        intro: r.body,
        status: r.status === 'visible' ? 'approved' : 'pending',
        at: new Date(r.ts).toISOString(),
        likes: r.likes,
      })),
    },
    200,
    headers,
  );
}

async function deleteIdentity(request: Request, env: Env, provider: string): Promise<Response> {
  const headers = corsHeaders(request, env);
  const me = await sessionUser(request, env);
  if (!me) return json({ ok: false, reason: 'unauthorized' }, 401, headers);

  // 邮箱是锚点，不能解绑；管理员也一样（否则找不回账号）
  if (provider === 'email') {
    return json({ ok: false, reason: 'protected', message: '邮箱是主身份，不能解绑' }, 400, headers);
  }
  const list = await listIdentities(env, me.account.id);
  if (!list.some((i) => i.provider === provider)) {
    return json({ ok: false, reason: 'not_bound' }, 404, headers);
  }
  if (list.length <= 1) {
    return json({ ok: false, reason: 'last_identity', message: '至少要留一种登录方式' }, 400, headers);
  }

  await removeIdentity(env, me.account.id, provider);
  const fresh = await findAccountById(env, me.account.id);
  return json({ ok: true, account: fresh ? await publicAccount(env, fresh) : null }, 200, headers);
}

export async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  const m = request.method;

  // 只做 GET / POST / PATCH / DELETE，其余一律 405（别默认放行）
  if (path === '/auth/me' && m === 'GET') return getMe(request, env);
  if (path === '/auth/email/start' && m === 'POST') return postEmailStart(request, env);
  if (path === '/auth/email/verify' && m === 'POST') return postEmailVerify(request, env);
  if (path === '/auth/logout' && m === 'POST') return postLogout(request, env);
  if (path === '/auth/profile' && m === 'PATCH') return patchProfile(request, env);
  if (path === '/auth/my-comments' && m === 'GET') return getMyComments(request, env);

  // 头像：读是公开的（<img src> 不需要会话），写要登录
  const av = path.match(/^\/auth\/avatar\/(\d+)$/);
  if (av && m === 'GET') return getAvatar(env, av[1]!);
  if (path === '/auth/avatar' && m === 'POST') return postAvatar(request, env);
  if (path === '/auth/avatar' && m === 'DELETE') return deleteAvatar(request, env);

  if (path === '/auth/github/start' && m === 'GET') return githubStart(request, env);
  if (path === '/auth/github/callback' && m === 'GET') return githubCallback(request, env);
  // GET 也认：绑定是一整页跳转（GitHub 授权完 302 回来），用 <a href> 最省事。
  // CSRF 风险低 —— 绑定写的是「当前会话」，而且要对方自己的 GitHub 已登录。
  if (path === '/auth/bind/github' && (m === 'POST' || m === 'GET')) {
    const me = await sessionUser(request, env);
    if (!me) return json({ ok: false, reason: 'unauthorized' }, 401, corsHeaders(request, env));
    return githubStart(request, env, me.account.id);
  }

  const un = path.match(/^\/auth\/identities\/([a-z]+)$/);
  if (un && m === 'DELETE') return deleteIdentity(request, env, un[1]!);

  // 兜底：不是 404 而是 405，方便区分「路径写错」和「方法写错」
  if (/^\/auth\//.test(path)) return json({ ok: false, reason: 'not_found' }, 404, corsHeaders(request, env));
  return json({ ok: false, reason: 'not_found' }, 404);
}

/** 给 friends-board 用：未登录时该说什么 */
export function loginRequiredMessage(): { ok: false; reason: string; message: string } {
  return {
    ok: false,
    reason: 'login_required',
    message: '登录之后才能留言 —— 用邮箱收个验证码就行，之后回访不用再填',
  };
}
