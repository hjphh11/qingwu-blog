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

  const row = await env.DB.prepare(
    'SELECT id, username, email, pass_hash, salt, iterations FROM admin_users WHERE username = ?',
  )
    .bind(username)
    .first<AdminRow>();

  let passOk = false;
  if (row) {
    passOk = await secretEqual(await pbkdf2(password, row.salt, row.iterations), row.pass_hash);
  } else {
    // 账号不存在也走一遍，耗时对齐（防用户名枚举）
    await pbkdf2(password, 'decoy-salt-for-timing', PBKDF2_ITER);
  }

  if (!passOk) {
    await recordAttempt(env, iph, false);
    return json({ ok: false, reason: 'bad_credentials', message: '账号或密码不正确' }, 401);
  }

  const now = Date.now();

  // 冷却：同一个账号 60 秒内只发一封，防止被拿来刷邮箱
  const last = await env.DB.prepare('SELECT sent_at FROM admin_codes WHERE user_id = ? ORDER BY sent_at DESC LIMIT 1')
    .bind(row!.id)
    .first<{ sent_at: number }>();
  if (last && now - last.sent_at < CODE_COOLDOWN_SEC * 1000) {
    const wait = Math.ceil((CODE_COOLDOWN_SEC * 1000 - (now - last.sent_at)) / 1000);
    return json({ ok: false, reason: 'cooldown', retryAfter: wait, message: `验证码已发送，请 ${wait} 秒后再试` }, 429);
  }

  const code = randomCode();
  const codeHash = await sha256(`${code}|${row!.salt}`);
  await env.DB.prepare(
    'INSERT INTO admin_codes (user_id, code_hash, sent_at, expires_at, tries, used) VALUES (?, ?, ?, ?, 0, 0)',
  )
    .bind(row!.id, codeHash, now, now + CODE_TTL_SEC * 1000)
    .run();

  const sent = await sendMail(env, {
    to: row!.email,
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

  return json({ ok: true, step: 'verify', email: maskEmail(row!.email), cooldown: CODE_COOLDOWN_SEC });
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
}

/** 校验 cookie；无效返回 null。**每个受保护接口都要先过这里。** */
export async function getAdmin(request: Request, env: Env): Promise<Admin | null> {
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
  return { id: row.id, username: row.username };
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
  const row = await env.DB.prepare('SELECT email, last_login_at FROM admin_users WHERE id = ?')
    .bind(admin.id)
    .first<{ email: string; last_login_at: number | null }>();
  return json({
    ok: true,
    authenticated: true,
    username: admin.username,
    email: row ? maskEmail(row.email) : '',
    lastLoginAt: row?.last_login_at ?? null,
  });
}

export async function postLogout(request: Request, env: Env): Promise<Response> {
  const token = readCookies(request)[COOKIE_NAME];
  if (token) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
}
