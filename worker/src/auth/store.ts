// 清吾 · 账号与会话
//
// 「邮箱是唯一锚点」这条规则只在这里实现一次 —— 别在路由里再写一份。
//
//   findAccountByEmail → 命中就登进去（补记本次 provider），未命中才建号
//
// 会话表同时服务前台与后台：`kind` 决定它过不过得了 requireAdmin。

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
import { emailHashOf } from './md5';

export interface AccountRow {
  id: number;
  email: string;
  email_hash: string;
  display_name: string | null;
  site_url: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  created_at: number;
  last_seen_at: number | null;
}

const ACCOUNT_COLS =
  'id, email, email_hash, display_name, site_url, avatar_url, role, status, created_at, last_seen_at';

export async function findAccountByEmail(env: Env, email: string): Promise<AccountRow | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  return env.DB.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE email = ?`)
    .bind(e)
    .first<AccountRow>();
}

export async function findAccountById(env: Env, id: number): Promise<AccountRow | null> {
  return env.DB.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = ?`)
    .bind(id)
    .first<AccountRow>();
}

/**
 * 建号。**只由「已验证邮箱」的路径调用** —— 未验证的邮箱不能占位，
 * 否则别人可以先填你的邮箱把账号抢走。
 */
export async function createAccount(
  env: Env,
  input: { email: string; displayName?: string; siteUrl?: string; avatarUrl?: string; role?: string },
): Promise<AccountRow> {
  const email = normalizeEmail(input.email);
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO accounts (email, email_hash, display_name, site_url, avatar_url, role, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      email,
      emailHashOf(email),
      input.displayName?.trim() || null,
      input.siteUrl?.trim() || null,
      input.avatarUrl?.trim() || null,
      input.role === 'admin' ? 'admin' : 'visitor',
      now,
      now,
    )
    .run();

  const row = await findAccountById(env, Number(res.meta.last_row_id));
  if (!row) throw new Error('account_create_failed');
  return row;
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
  kind: 'visitor' | 'admin';
  /** 直接回给前端的形状（**不含邮箱原文**） */
}

export async function createSession(
  env: Env,
  request: Request,
  accountId: number,
  kind: 'visitor' | 'admin',
): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO auth_sessions (token_hash, account_id, kind, created_at, expires_at, ip_hash, ua)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await sha256Hex(token),
      accountId,
      kind,
      now,
      now + SESSION_TTL_SEC * 1000,
      await ipHash(request, env),
      (request.headers.get('user-agent') || '').slice(0, 200),
    )
    .run();
  // 顺手清过期会话，别让表无限长（失败不影响登录）
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?')
    .bind(now - 86_400_000)
    .run()
    .catch(() => undefined);
  return token;
}

/** 读当前会话；无效/过期返回 null。**每个需要身份的接口都先过这里。** */
export async function sessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length < 32) return null;
  const tokenHash = await sha256Hex(token);

  const row = await env.DB.prepare(
    `SELECT a.id AS id, a.email AS email, a.email_hash AS email_hash, a.display_name AS display_name,
            a.site_url AS site_url, a.avatar_url AS avatar_url, a.role AS role, a.status AS status,
            a.created_at AS created_at, a.last_seen_at AS last_seen_at,
            s.kind AS s_kind, s.expires_at AS s_exp
       FROM auth_sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<AccountRow & { s_kind: string; s_exp: number }>();

  if (!row) return null;
  if (row.s_exp < Date.now()) {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
      .catch(() => undefined);
    return null;
  }
  if (row.status === 'banned' || row.status === 'muted') {
    // 封禁/禁言：会话留着也没用，直接当作未登录（前台会看到只读态）
    return null;
  }
  return { account: row, kind: row.s_kind === 'admin' ? 'admin' : 'visitor' };
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
  const owner = await identityOwner(env, provider, uid);
  if (owner && owner !== accountId) return 'taken';
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO account_identities (account_id, provider, uid, meta, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, uid) DO UPDATE SET last_used_at = excluded.last_used_at`,
  )
    .bind(accountId, provider, uid, meta ? JSON.stringify(meta) : null, now, now)
    .run();
  return 'ok';
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
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM account_identities WHERE account_id = ?',
  )
    .bind(accountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
