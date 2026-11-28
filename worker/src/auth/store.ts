// 清吾 · 账号与会话
//
// 「邮箱是唯一锚点」这条规则只在这里实现一次 —— 别在路由里再写一份。
//
//   findAccountByEmail → 命中就登进去（补记本次 provider）；新账号通过邮箱验证注册创建
//
// 会话表同时服务前台与后台：`kind` 决定它过不过得了 requireAdmin。

import { AuthError } from './error';
import type { Env } from '../types';
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  ipHash,
  normalizeEmail,
  randomToken,
  readCookie,
  sha256Hex,
} from './common';

export interface AccountRow {
  username: string;
  username_provisional: number;
  email_verified_at: number | null;
  has_password: number;
  matrix_status: string;
  matrix_user_id: string | null;
  matrix_pw_synced_at: number | null;
  id: number;
  email: string;
  email_hash: string;
  display_name: string | null;
  site_url: string | null;
  avatar_url: string | null;
  /** 自己写的一句简介（人卡上那句「关于」）。空 = 没写 */
  bio: string | null;
  role: string;
  status: string;
  created_at: number;
  last_seen_at: number | null;
}

const ACCOUNT_COLS =
  'username, username_provisional, email_verified_at, pass_hash IS NOT NULL AS has_password, matrix_status, matrix_user_id, matrix_pw_synced_at, id, email, email_hash, display_name, site_url, avatar_url, bio, role, status, created_at, last_seen_at';

export async function findAccountByEmail(env: Env, email: string): Promise<AccountRow | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  return env.DB.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE email = ? AND role <> 'chat_guest'`)
    .bind(e)
    .first<AccountRow>();
}

export async function findAccountById(env: Env, id: number): Promise<AccountRow | null> {
  return env.DB.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = ?`)
    .bind(id)
    .first<AccountRow>();
}

export async function touchAccount(env: Env, id: number): Promise<void> {
  await env.DB.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?')
    .bind(Date.now(), id)
    .run()
    .catch(() => undefined);
}

// ——————————————————————————————————————————————————————————
// 会话
// ——————————————————————————————————————————————————————————
export interface SessionUser {
  account: AccountRow;
  kind: 'visitor' | 'admin' | 'chat_guest';
  /** 直接回给前端的形状（**不含邮箱原文**） */
}

export async function createSession(
  env: Env,
  request: Request,
  accountId: number,
  kind: 'visitor' | 'admin',
  expected?: { hash?: string; email: string },
): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  const session = await env.DB.prepare(
    `INSERT INTO auth_sessions (token_hash, account_id, kind, created_at, expires_at, ip_hash, ua)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND status='active'
       AND (? IS NULL OR pass_hash=?) AND (? IS NULL OR email=?))`,
  )
    .bind(
      await sha256Hex(token),
      accountId,
      kind,
      now,
      now + SESSION_TTL_SEC * 1000,
      await ipHash(request, env),
      (request.headers.get('user-agent') || '').slice(0, 200),
      accountId,
      expected?.hash ?? null,
      expected?.hash ?? null,
      expected?.email ?? null,
      expected?.email ?? null,
    )
    .run();
  if (!session.meta.changes) throw new AuthError(401, 'changed', '凭据已更改，请重新登录');
  // 顺手清过期会话，别让表无限长（失败不影响登录）
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?')
    .bind(now - 86_400_000)
    .run()
    .catch(() => undefined);
  const guestToken = readCookie(request, CHAT_GUEST_COOKIE);
  if (guestToken) {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE kind='chat_guest' AND token_hash=?")
      .bind(await sha256Hex(guestToken)).run();
  }
  return token;
}

/**
 * 读当前会话；无效/过期返回 null。**每个需要身份的接口都先过这里。**
 *
 * 会话与设备绑定（2026-11-14 加固）：
 *   · `kind='admin'` —— 后台会话要求 UA **完全一致**，不一致直接作废（并删行）；
 *   · `kind='visitor'` —— 只比 UA 的「平台段」（前 60 字符）。浏览器升级版本号
 *     不该把人踢下线，但换设备/换浏览器会立刻失效。
 * 以前 `ip_hash`/`ua` 写了却从不比对，cookie 一泄露就能异地重放 30 天。
 */
export const CHAT_GUEST_COOKIE = 'q_chat_guest';

export function sessionUser(request: Request, env: Env) {
  return readSession(request, env, false);
}

export async function chatSessionUser(request: Request, env: Env) {
  return (await sessionUser(request, env)) ?? readSession(request, env, true);
}

async function readSession(request: Request, env: Env, guest: boolean): Promise<SessionUser | null> {
  const token = readCookie(request, guest ? CHAT_GUEST_COOKIE : SESSION_COOKIE);
  if (!token || token.length < 32) return null;
  const tokenHash = await sha256Hex(token);

  const row = await env.DB.prepare(
    `SELECT a.username, a.username_provisional, a.email_verified_at, a.pass_hash IS NOT NULL AS has_password,
            a.matrix_status, a.matrix_user_id, a.matrix_pw_synced_at, a.id AS id, a.email AS email, a.email_hash AS email_hash, a.display_name AS display_name,
            a.site_url AS site_url, a.avatar_url AS avatar_url, a.bio AS bio,
            a.role AS role, a.status AS status,
            a.created_at AS created_at, a.last_seen_at AS last_seen_at,
            s.kind AS s_kind, s.expires_at AS s_exp, s.ua AS s_ua
       FROM auth_sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<AccountRow & { s_kind: string; s_exp: number; s_ua: string | null }>();

  if (!row) return null;
  const guestSession = row.s_kind === 'chat_guest' && row.role === 'chat_guest';
  const siteSession = (row.s_kind === 'admin' || row.s_kind === 'visitor') && row.role !== 'chat_guest';
  if (!(guest ? guestSession : siteSession)) return null;
  if (row.s_exp < Date.now()) {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
      .catch(() => undefined);
    return null;
  }
  if (row.status !== 'active') {
    // 封禁/禁言：会话留着也没用，直接当作未登录（前台会看到只读态）
    return null;
  }

  // —— 设备绑定校验 ——
  const nowUa = (request.headers.get('user-agent') || '').slice(0, 200);
  const boundUa = row.s_ua || '';
  if (boundUa) {
    const isAdmin = row.s_kind === 'admin';
    const mismatch = isAdmin ? boundUa !== nowUa : boundUa.slice(0, 60) !== nowUa.slice(0, 60);
    if (mismatch) {
      await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
        .bind(tokenHash)
        .run()
        .catch(() => undefined);
      console.warn('[auth] 会话与设备 UA 不符，已作废:', isAdmin ? 'admin' : 'visitor');
      return null;
    }
  }

  return { account: row, kind: guest ? 'chat_guest' : row.s_kind === 'admin' ? 'admin' : 'visitor' };
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .run()
    .catch(() => undefined);
}

// ——————————————————————————————————————————————————————————
// 登录方式（identities）
// ——————————————————————————————————————————————————————————
export interface IdentityRow {
  provider: string;
  uid: string;
  meta: string | null;
  created_at: number;
  last_used_at: number | null;
}

export async function listIdentities(env: Env, accountId: number): Promise<IdentityRow[]> {
  const res = await env.DB.prepare(
    'SELECT provider, uid, meta, created_at, last_used_at FROM account_identities WHERE account_id = ? ORDER BY id',
  )
    .bind(accountId)
    .all<IdentityRow>();
  return res.results ?? [];
}

export async function identityOwner(env: Env, provider: string, uid: string): Promise<number | null> {
  const row = await env.DB.prepare(
    'SELECT account_id AS account_id FROM account_identities WHERE provider = ? AND uid = ?',
  )
    .bind(provider, uid)
    .first<{ account_id: number }>();
  return row?.account_id ?? null;
}

/**
 * 挂一条登录方式。
 *
 * 返回 `taken` 表示这枚 GitHub 已经被别的账号占了 —— 调用方据此决定
 * 是「直接登进那个账号」（未登录场景）还是「409 拒绝」（已登录绑定场景）。
 */
export async function attachIdentity(
  env: Env,
  accountId: number,
  provider: string,
  uid: string,
  meta?: Record<string, unknown>,
): Promise<'ok' | 'taken'> {
  const now = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO account_identities (account_id, provider, uid, meta, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, uid) DO UPDATE SET last_used_at = excluded.last_used_at WHERE account_id = excluded.account_id`,
  )
    .bind(accountId, provider, uid, meta ? JSON.stringify(meta) : null, now, now)
    .run();
  return result.meta.changes ? 'ok' : 'taken';
}

export async function removeIdentity(env: Env, accountId: number, provider: string): Promise<boolean> {
  const res = await env.DB.prepare(
    'DELETE FROM account_identities WHERE account_id = ? AND provider = ?',
  )
    .bind(accountId, provider)
    .run();
  return Number(res.meta.changes ?? 0) > 0;
}

/** 是否还剩至少一种可登录方式（解绑前的守卫） */
export async function identityCount(env: Env, accountId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM account_identities WHERE account_id = ?')
    .bind(accountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
