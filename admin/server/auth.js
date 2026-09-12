// 登录鉴权：单用户密码（argon2）+ 签名会话 cookie + 登录失败限速。
//
// 网络层已有 Tailscale 私网限制（只监听 127.0.0.1），密码是第二道锁。
import { createHmac, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { config } from './config.js';

export const COOKIE_NAME = 'qw_admin';

/** 会话 cookie 的选项：HttpOnly + SameSite；是否加 Secure 由配置决定 */
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // 默认生产带 Secure；但走 `tailscale serve --http` 的部署必须关掉
    // （http 下浏览器不保存 Secure cookie，登录会失效）—— 见 config.cookieSecure
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  };
}

const sign = (payload) => createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

/** 生成会话 token：payload.签名（无状态，重启不丢登录态） */
export function createSession(now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ exp: now + config.sessionDays * 86_400_000 }),
    'utf8',
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** 校验会话 token：签名对得上 + 没过期 */
export function verifySession(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expect = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

/** 校验密码 */
export async function checkPassword(password) {
  if (typeof password !== 'string' || password.length === 0) return false;
  return argonVerify(config.passwordHash, password);
}

/** 生成 argon2 哈希（给 scripts/hash-password.mjs 用） */
export async function hashPassword(password) {
  return argonHash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

// ——— 登录失败限速（进程内；单用户后台够用）———
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map(); // ip -> { count, resetAt }

export function loginRateLimited(ip) {
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt <= Date.now()) return { limited: false };
  if (rec.count < MAX_ATTEMPTS) return { limited: false };
  return { limited: true, retryAfterSec: Math.ceil((rec.resetAt - Date.now()) / 1000) };
}

export function recordLoginFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  rec.count += 1;
}

export function clearLoginFailures(ip) {
  attempts.delete(ip);
}

/** Express 中间件：要求已登录 */
export function requireAuth(req, res, next) {
  if (verifySession(req.cookies?.[COOKIE_NAME])) return next();
  res.status(401).json({ error: 'unauthorized', message: '请先登录' });
}
