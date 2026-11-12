// 清吾 · 后台认证（两级登录 + 会话）
//
// 流程：账号密码 → 6 位邮箱验证码 → HttpOnly cookie（30 天）。
// 设计取舍见 docs/方案-后台-admin.md 第五节，这里只记实现上的硬约束：
//
//  · 所有状态都在 D1，Worker 没有内存态（`wrangler dev` 随时重载，多实例也不一致）。
//  · 密码用 PBKDF2-SHA256 存哈希；验证码与 session token **都只存哈希**。
//  · 账号不存在时也照样算一次 PBKDF2，避免靠响应时间探测账号是否存在。
//  · 失败计数按 IP 哈希，15 分钟内 15 次就锁 —— 验证码只有 6 位，没有限流等于没有。

import type { Env } from '../types';
import { json, secretEqual } from '../util';
import { sendMail } from '../mail';
// 统一身份：管理员就是 accounts 里 role='admin' 的那一行，会话与访客同一张表
import { SESSION_COOKIE, clearCookieOf, cookieOf, isOn } from '../auth/common';
import { createSession, destroySession, sessionUser } from '../auth/store';
import { sendLoginCode, verifyLoginCode } from '../auth/codes';

/** 与脚本 `scripts/create-admin.mjs` 必须一致，否则登录永远失败 */
export const PBKDF2_ITER = 150_000;

const CODE_TTL_SEC = 300; // 验证码有效期 5 分钟
const CODE_COOLDOWN_SEC = 60; // 重发冷却
const CODE_MAX_TRIES = 5; // 单个码最多试 5 次
const SESSION_TTL_SEC = 30 * 86_400; // 会话 30 天
const LOCK_WINDOW_SEC = 15 * 60;
const LOCK_MAX_FAIL = 15;
const COOKIE_NAME = 'q_admin';

// ——————————————————————————————————————————————————————————
// 基础工具
// ——————————————————————————————————————————————————————————
const enc = new TextEncoder();

function hex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of u8) s += b.toString(16).padStart(2, '0');
  return s;
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function pbkdf2(password: string, salt: string, iterations = PBKDF2_ITER): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return hex(bits);
}

/** 32 字节随机 token（十六进制 64 字符） */
function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return hex(buf);
}

/** 6 位数字验证码 —— 用 CSPRNG，不用 Math.random */
function randomCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, '0');
}

/** 取客户端 IP：nginx 会传 X-Forwarded-For / X-Real-IP，云上还有 CF 头 */
function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get('cf-connecting-ip') ||
    h.get('x-real-ip') ||
    (h.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

async function ipHash(request: Request, env: Env): Promise<string> {
  return (await sha256(`${env.HIT_IP_SALT || 'no-salt'}|${clientIp(request)}`)).slice(0, 16);
}

function readCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * 组 Set-Cookie。
 * `Secure` 只在 https 下加 —— 否则本地 http 调试时浏览器直接丢弃这个 cookie，
 * 表现为「登录成功但立刻又回到登录页」，很难查。
 */
function sessionCookie(request: Request, token: string, maxAgeSec: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const v = await request.json();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown, max = 200): string => String(v ?? '').trim().slice(0, max);

// ——————————————————————————————————————————————————————————
// 限流
// ——————————————————————————————————————————————————————————
/** 返回还要锁多少秒；0 = 没锁 */
async function lockRemain(env: Env, iph: string): Promise<number> {
  const now = Date.now();
  const since = now - LOCK_WINDOW_SEC * 1000;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n, MAX(ts) AS last FROM admin_attempts WHERE ip_hash = ? AND ts >= ? AND ok = 0',
  )
    .bind(iph, since)
    .first<{ n: number; last: number | null }>();
  if (!row || row.n < LOCK_MAX_FAIL) return 0;
  const unlockAt = (row.last ?? now) + LOCK_WINDOW_SEC * 1000;
  return Math.max(1, Math.ceil((unlockAt - now) / 1000));
}

async function recordAttempt(env: Env, iph: string, ok: boolean): Promise<void> {
  const now = Date.now();
  await env.DB.prepare('INSERT INTO admin_attempts (ip_hash, ts, ok) VALUES (?, ?, ?)')
    .bind(iph, now, ok ? 1 : 0)
    .run();
  // 顺手清 1 天前的记录，别让这张表无限长
  await env.DB.prepare('DELETE FROM admin_attempts WHERE ts < ?')
    .bind(now - 86_400_000)
    .run()
    .catch(() => undefined);
}

/** 邮箱只露前 3 位 + 域名：145****@qq.com */
function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '***';
  const head = name.slice(0, Math.min(3, Math.max(1, name.length - 1)));
  return `${head}****@${domain}`;
}

interface AdminRow {
  id: number;
  username: string;
  email: string;
  pass_hash: string;
  salt: string;
  iterations: number;
}

// ——————————————————————————————————————————————————————————
// 身份解析：统一账号优先，旧 admin_users 兜底
// ——————————————————————————————————————————————————————————
//
// 「两边一套身份」的落点就在这儿：管理员不是另一张表里的人，而是
// `accounts` 里 `role='admin'` 的那一行。旧表在过渡期只读保留，
// 等 `AUTH_LEGACY_ADMIN=0` 之后就可以彻底不动它了。
interface ResolvedAdmin {
  /** true = 来自旧 admin_users（过渡期兜底） */
  legacy: boolean;
  /** 统一会话要写哪个 account id；legacy 时为空 */
  accountId: number | null;
  /** 旧表 id，只为兼容 admin_codes / admin_sessions */
  userId: number | null;
  username: string;
  email: string;
  passHash: string;
  salt: string;
  iterations: number;
}

async function resolveAdmin(env: Env, username: string): Promise<ResolvedAdmin | null> {
  // 0023 没跑时 accounts 不存在 —— 别让一次没跑完的迁移把后台锁死
  try {
    const a = await env.DB.prepare(
      `SELECT id, email, display_name, pass_hash, salt, iterations FROM accounts
        WHERE role = 'admin' AND pass_hash IS NOT NULL AND (display_name = ? OR email = ?)
        LIMIT 1`,
    )
      .bind(username, username.toLowerCase())
      .first<{
        id: number;
        email: string;
        display_name: string | null;
        pass_hash: string;
        salt: string;
        iterations: number;
      }>();
    if (a) {
      return {
        legacy: false,
        accountId: a.id,
        userId: null,
        username: a.display_name || a.email.split('@')[0] || username,
        email: a.email,
        passHash: a.pass_hash,
        salt: a.salt,
        iterations: a.iterations,
      };
    }
  } catch {
    /* accounts 还没建，落到旧表 */
  }

  const u = await env.DB.prepare(
    'SELECT id, username, email, pass_hash, salt, iterations FROM admin_users WHERE username = ?',
  )
    .bind(username)
    .first<AdminRow>();
  if (!u) return null;

  return {
    legacy: true,
    accountId: null,
    userId: u.id,
    username: u.username,
    email: u.email,
    passHash: u.pass_hash,
    salt: u.salt,
    iterations: u.iterations,
  };
}

// ——————————————————————————————————————————————————————————
// 第一步：账号 + 密码 → 发验证码
// ——————————————————————————————————————————————————————————
export async function postLogin(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const username = str(body.username, 60);
  const password = str(body.password, 200);
  const iph = await ipHash(request, env);

  if (!username || !password) return json({ ok: false, reason: 'bad_request' }, 400);

  const remain = await lockRemain(env, iph);
  if (remain > 0) {
    return json({ ok: false, reason: 'locked', retryAfter: remain, message: `尝试次数过多，请 ${Math.ceil(remain / 60)} 分钟后再试` }, 429);
  }

  const resolved = await resolveAdmin(env, username);

  let passOk = false;
  if (resolved) {
    passOk = await secretEqual(await pbkdf2(password, resolved.salt, resolved.iterations), resolved.passHash);
  } else {
    // 账号不存在也走一遍，耗时对齐（防用户名枚举）
    await pbkdf2(password, 'decoy-salt-for-timing', PBKDF2_ITER);
  }

  if (!passOk || !resolved) {
    await recordAttempt(env, iph, false);
    return json({ ok: false, reason: 'bad_credentials', message: '账号或密码不正确' }, 401);
  }

  const now = Date.now();

  // 统一账号：验证码走 auth_codes，与访客同一套发信、同一套限流
  if (!resolved.legacy && resolved.accountId) {
    const r = await sendLoginCode(env, request, resolved.email, 'login');
    if (!r.ok) {
      const status = r.reason === 'mail' ? 502 : r.reason === 'bad_email' ? 400 : 429;
      return json(
        { ok: false, reason: r.reason, retryAfter: r.retryAfter, message: `验证码${r.message}` },
        status,
      );
    }
    return json({ ok: true, step: 'verify', email: maskEmail(resolved.email), cooldown: CODE_COOLDOWN_SEC });
  }

  // 冷却：同一个账号 60 秒内只发一封，防止被拿来刷邮箱
  const last = await env.DB.prepare('SELECT sent_at FROM admin_codes WHERE user_id = ? ORDER BY sent_at DESC LIMIT 1')
    .bind(resolved.userId)
    .first<{ sent_at: number }>();
  if (last && now - last.sent_at < CODE_COOLDOWN_SEC * 1000) {
    const wait = Math.ceil((CODE_COOLDOWN_SEC * 1000 - (now - last.sent_at)) / 1000);
    return json({ ok: false, reason: 'cooldown', retryAfter: wait, message: `验证码已发送，请 ${wait} 秒后再试` }, 429);
  }

  const code = randomCode();
  const codeHash = await sha256(`${code}|${resolved.salt}`);
  await env.DB.prepare(
    'INSERT INTO admin_codes (user_id, code_hash, sent_at, expires_at, tries, used) VALUES (?, ?, ?, ?, 0, 0)',
  )
    .bind(resolved.userId, codeHash, now, now + CODE_TTL_SEC * 1000)
    .run();

  const sent = await sendMail(env, {
    to: resolved.email,
    subject: '清吾后台 · 登录验证码',
    text: [
      `验证码：${code}`,
      '',
      `5 分钟内有效，只能用于一次登录。如果不是你本人操作，忽略这封邮件即可 —— 密码没有泄露的前提下对方进不来。`,
      '',
      `时间：${new Date(now + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)}（北京时间）`,
    ].join('\n'),
  });

  if (!sent) {
    // 发不出去就把这个码作废，别留下一个谁也拿不到的验证码
    await env.DB.prepare('UPDATE admin_codes SET used = 1 WHERE code_hash = ?').bind(codeHash).run();
    return json({ ok: false, reason: 'mail_failed', message: '验证码发送失败，请稍后重试' }, 502);
  }

  return json({ ok: true, step: 'verify', email: maskEmail(resolved.email), cooldown: CODE_COOLDOWN_SEC });
}

// ——————————————————————————————————————————————————————————
// 第二步：验证码 → 会话
// ——————————————————————————————————————————————————————————
export async function postVerify(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const username = str(body.username, 60);
  const code = str(body.code, 12).replace(/\s/g, '');
  const iph = await ipHash(request, env);

  if (!username || !/^\d{6}$/.test(code)) return json({ ok: false, reason: 'bad_request' }, 400);

  const remain = await lockRemain(env, iph);
  if (remain > 0) {
    return json({ ok: false, reason: 'locked', retryAfter: remain, message: `尝试次数过多，请 ${Math.ceil(remain / 60)} 分钟后再试` }, 429);
  }

  // 统一账号：验证码在 auth_codes 里（与访客同一套发信/限流），会话写 auth_sessions
  const resolved = await resolveAdmin(env, username);
  if (resolved && !resolved.legacy && resolved.accountId) {
    const v = await verifyLoginCode(env, request, resolved.email, code, 'login');
    if (!v.ok) {
      return json(
        { ok: false, reason: v.reason, left: v.left, message: v.message },
        v.reason === 'locked' ? 429 : 401,
      );
    }
    const token = await createSession(env, request, resolved.accountId, 'admin');
    await recordAttempt(env, iph, true);
    await env.DB.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?')
      .bind(Date.now(), resolved.accountId)
      .run()
      .catch(() => undefined);
    return json(
      { ok: true, username: resolved.username, email: maskEmail(resolved.email) },
      200,
      { 'set-cookie': cookieOf(request, SESSION_COOKIE, token, SESSION_TTL_SEC) },
    );
  }

  const user = await env.DB.prepare('SELECT id, username, email, salt FROM admin_users WHERE username = ?')
    .bind(username)
    .first<{ id: number; username: string; email: string; salt: string }>();
  if (!user) {
    await recordAttempt(env, iph, false);
    return json({ ok: false, reason: 'bad_code', message: '验证码不正确或已过期' }, 401);
  }

  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT id, code_hash, tries FROM admin_codes WHERE user_id = ? AND used = 0 AND expires_at > ? ORDER BY sent_at DESC LIMIT 1',
  )
    .bind(user!.id, now)
    .first<{ id: number; code_hash: string; tries: number }>();

  if (!row) {
    await recordAttempt(env, iph, false);
    return json({ ok: false, reason: 'expired', message: '验证码已过期，请重新获取' }, 401);
  }
  if (row.tries >= CODE_MAX_TRIES) {
    await recordAttempt(env, iph, false);
    return json({ ok: false, reason: 'exhausted', message: '该验证码尝试次数过多，请重新获取' }, 401);
  }

  const ok = await secretEqual(await sha256(`${code}|${user!.salt}`), row.code_hash);
  if (!ok) {
    await env.DB.prepare('UPDATE admin_codes SET tries = tries + 1 WHERE id = ?').bind(row.id).run();
    await recordAttempt(env, iph, false);
    const left = CODE_MAX_TRIES - row.tries - 1;
    return json({ ok: false, reason: 'bad_code', left, message: `验证码不正确，还剩 ${Math.max(0, left)} 次` }, 401);
  }

  // 通过：作废这个码、开一个会话
  const token = randomToken();
  const tokenHash = await sha256(token);
  const ua = (request.headers.get('user-agent') || '').slice(0, 200);

  await env.DB.batch([
    env.DB.prepare('UPDATE admin_codes SET used = 1 WHERE id = ?').bind(row.id),
    env.DB.prepare('INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at, ip_hash, ua) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(tokenHash, user!.id, now, now + SESSION_TTL_SEC * 1000, iph, ua),
    env.DB.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').bind(now, user!.id),
    // 顺手清过期会话与旧码
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM admin_codes WHERE expires_at < ?').bind(now - 86_400_000),
  ]);

  await recordAttempt(env, iph, true);

  return json(
    { ok: true, username: user!.username, email: maskEmail(user!.email) },
    200,
    { 'set-cookie': sessionCookie(request, token, SESSION_TTL_SEC) },
  );
}

// ——————————————————————————————————————————————————————————
// 会话
// ——————————————————————————————————————————————————————————
export interface Admin {
  id: number;
  username: string;
  /** 统一会话才有（旧 admin_sessions 的会话为空，getSessionInfo 会回查旧表） */
  email?: string;
  lastLoginAt?: number | null;
  legacy?: boolean;
}

/**
 * 校验会话。**每个受保护接口都要先过这里。**
 *
 * 顺序是有讲究的：先认统一会话（q_sess + kind=admin），再回落旧 admin_sessions。
 * 过渡期两者都算数 —— 后台是修错的地方，不能因为迁移写错就把自己关在门外。
 * 确认稳定后把 `AUTH_LEGACY_ADMIN` 设成 0，旧表就只剩只读留档的作用。
 */
export async function getAdmin(request: Request, env: Env): Promise<Admin | null> {
  // ① 统一会话
  try {
    const s = await sessionUser(request, env);
    if (s && s.kind === 'admin' && s.account.role === 'admin') {
      return {
        id: s.account.id,
        username: s.account.display_name || s.account.email.split('@')[0] || 'admin',
        email: s.account.email,
        lastLoginAt: s.account.last_seen_at,
      };
    }
  } catch {
    /* auth_sessions 还没建：继续看旧表 */
  }

  if (!isOn(env.AUTH_LEGACY_ADMIN)) return null;

  // ② 旧会话（过渡期）
  const token = readCookies(request)[COOKIE_NAME];
  if (!token || token.length < 32) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.username AS username, s.expires_at AS expires_at
       FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{ id: number; username: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return { id: row.id, username: row.username, legacy: true };
}

/** 给受保护接口用的包装：没登录直接 401，省得每个 handler 都写一遍 */
export async function requireAdmin(
  request: Request,
  env: Env,
  handler: (admin: Admin) => Promise<Response>,
): Promise<Response> {
  const admin = await getAdmin(request, env);
  if (!admin) return json({ ok: false, reason: 'unauthorized' }, 401);
  return handler(admin);
}

export async function getSessionInfo(request: Request, env: Env): Promise<Response> {
  const admin = await getAdmin(request, env);
  if (!admin) return json({ ok: false, authenticated: false }, 401);

  // 统一会话自带邮箱；旧会话回查 admin_users
  let email = admin.email ? maskEmail(admin.email) : '';
  let lastLoginAt = admin.lastLoginAt ?? null;
  if (!admin.email) {
    const row = await env.DB.prepare('SELECT email, last_login_at FROM admin_users WHERE id = ?')
      .bind(admin.id)
      .first<{ email: string; last_login_at: number | null }>()
      .catch(() => null);
    if (row) {
      email = maskEmail(row.email);
      lastLoginAt = row.last_login_at;
    }
  }

  return json({
    ok: true,
    authenticated: true,
    username: admin.username,
    email,
    lastLoginAt,
  });
}

export async function postLogout(request: Request, env: Env): Promise<Response> {
  // 两张表都清 —— 过渡期可能同时存在两种会话
  await destroyUnifiedSession(request, env);
  const token = readCookies(request)[COOKIE_NAME];
  if (token) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
      .bind(await sha256(token))
      .run()
      .catch(() => undefined);
  }
  // 两条 cookie 要分别 append —— 用对象字面量塞两个同名头会被后者覆盖
  const res = json({ ok: true });
  res.headers.append('set-cookie', sessionCookie(request, '', 0));
  res.headers.append('set-cookie', clearCookieOf(request, SESSION_COOKIE));
  return res;
}

/** 统一会话的注销：单独包一层，表还没建时也不该抛错 */
async function destroyUnifiedSession(request: Request, env: Env): Promise<void> {
  try {
    await destroySession(request, env);
  } catch {
    /* 迁移未跑，忽略 */
  }
}

/**
 * 本地预览后台时的**一键登录** —— 只在配了 `ADMIN_DEV_LOGIN` 时存在。
 *
 * 正常流程是「密码 → 邮件验证码」。本地没有发信中继，改一版样式就要去 D1 里
 * 捞一次验证码。这个口子只省掉那一步：换到的仍是**真会话**（照常写
 * `admin_sessions`、照常发 cookie），后面每个接口过的还是同一条 `getAdmin`。
 *
 * 三道锁，缺一不可：
 *   1. 没配 `ADMIN_DEV_LOGIN` → 404，线上这条路由等于不存在；
 *   2. 请求 host 不是本机回环 → 404，误配了也只在本机能用；
 *   3. 口令不对 → 403。
 * 变量只写在 `worker/.dev.vars`（已 gitignore）。
 * 复核：`grep ADMIN_DEV_LOGIN worker/wrangler.toml` 应无结果。
 */
export async function getDevLogin(request: Request, env: Env): Promise<Response> {
  const secret = env.ADMIN_DEV_LOGIN;
  const url = new URL(request.url);
  const host = url.hostname;
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (!secret || !loopback) return json({ ok: false, reason: 'not_found' }, 404);
  if (url.searchParams.get('token') !== secret) return json({ ok: false, reason: 'bad_token' }, 403);

  const user = await env.DB.prepare('SELECT id, username FROM admin_users ORDER BY id LIMIT 1').first<{
    id: number;
    username: string;
  }>();

  if (!user) {
    // 只有统一账号（没跑 create-admin 的旧脚本）：直接开一个 kind='admin' 的会话
    try {
      const a = await env.DB.prepare("SELECT id FROM accounts WHERE role = 'admin' ORDER BY id LIMIT 1")
        .first<{ id: number }>();
      if (a) {
        const t = await createSession(env, request, a.id, 'admin');
        return new Response(null, {
          status: 302,
          headers: {
            location: '/admin/console',
            'set-cookie': cookieOf(request, SESSION_COOKIE, t, SESSION_TTL_SEC),
          },
        });
      }
    } catch {
      /* accounts 还没建，落到下面的 409 */
    }
    return json({ ok: false, reason: 'no_admin', message: '本地库里还没有管理员，先跑 scripts/create-admin.mjs' }, 409);
  }

  const now = Date.now();
  const token = randomToken();
  await env.DB.prepare(
    'INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at, ip_hash, ua) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(await sha256(token), user.id, now, now + SESSION_TTL_SEC * 1000, 'dev', 'dev-login')
    .run();

  // 302 直接落控制台：地图上少一步手点，也不给「登录成功但停在空白页」的机会
  return new Response(null, {
    status: 302,
    headers: { location: '/admin/console', 'set-cookie': sessionCookie(request, token, SESSION_TTL_SEC) },
  });
}
