// 清吾 · 邮箱验证码（登录 / 绑定共用）
//
// 首次登录即注册：账号这会儿可能还不存在，所以用 email 定位、account_id 可空。
//
// 四道闸，缺一不可（6 位数字没有限流等于没有）：
//   ① 同邮箱 60 秒冷却        ② 同邮箱 24h 最多 10 封
//   ③ 同 IP 1h 最多 10 封     ④ 单码最多试 5 次
// 验证失败另按 IP 计数：15 分钟内 15 次失败就锁 15 分钟。
//
// ⚠️ 隐私边界：**邮箱是否存在不影响响应**。发码一律说「发出去了」，
//    失败也只说「没发出去」，绝不暗示「这个邮箱没注册过」。

import type { Env } from '../types';
import { secretEqual } from '../util';
import { sendMail } from '../mail';
import {
  clientIp,
  hexOf,
  ipHash,
  isEmail,
  normalizeEmail,
  randomCode,
  randomToken,
  sha256Hex,
  siteUrl,
} from './common';

const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const CODE_MAX_TRIES = 5;
const EMAIL_DAY_MAX = 10;
const IP_HOUR_MAX = 10;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MAX_FAIL = 15;

export type SendResult =
  | { ok: true; devCode?: string }
  | {
      ok: false;
      reason: 'bad_email' | 'cooldown' | 'limited' | 'locked' | 'mail';
      message: string;
      retryAfter?: number;
    };

/**
 * 本地预览用的验证码旁路 —— 与 `ADMIN_DEV_LOGIN` 同一套思路。
 *
 * 本机没有发信中继（`.dev.vars` 里没有 RESEND_KEY），验证码根本寄不出去，
 * 「登录后是什么样」就永远看不到。开着它时**不发信**，直接把码回给前端。
 *
 * ⚠️ 判据是 **`ENVIRONMENT === 'dev'`**，不是「host 是不是回环」。
 * 原来判 `new URL(request.url).hostname`，而 nginx 的 `proxy_set_header Host $host`
 * 原样透传客户端 Host —— 任何人发 `Host: 127.0.0.1` 都能让 Worker 以为请求来自本机，
 * 配合 `AUTH_DEV_CODE=1` 就能拿到任意邮箱的验证码（2026-11-14 复核）。
 * 生产不配 ENVIRONMENT，这条分支永不成立。
 * 复核：`grep AUTH_DEV_CODE worker/wrangler.toml` 应无结果。
 */
function devCodeAllowed(_request: Request, env: Env): boolean {
  return env.ENVIRONMENT === 'dev' && env.AUTH_DEV_CODE === '1';
}

/**
 * 验证码哈希。
 *
 * 配了 `OTP_PEPPER` 就用 `HMAC-SHA256(pepper, purpose|email|code)`：库被整表读走
 * （备份、D1 dump、蜜罐镜像）也推不回 6 位码 —— 密钥不在库里。
 * 以前是 `SHA-256(code|salt)` 而盐就存在同一行，10^6 空间秒级可穷举，
 * 表注释里「库被读走也推不回」那句在密码学上不成立。
 *
 * 没配 pepper 时退回旧口径，保证升级前写入的老行仍能验证；新码统一带 `hmac1:` 前缀，
 * 两种口径可共存（前缀不同，不会撞）。
 */
async function codeHashOf(
  env: Env,
  purpose: string,
  email: string,
  code: string,
  salt: string,
): Promise<string> {
  if (!env.OTP_PEPPER) return sha256Hex(`${code}|${salt}`);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.OTP_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${purpose}|${email}|${code}`));
  return `hmac1:${hexOf(sig)}`;
}

async function lockRemain(env: Env, iph: string): Promise<number> {
  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n, MAX(ts) AS last FROM auth_attempts WHERE ip_hash = ? AND ts >= ? AND ok = 0',
  )
    .bind(iph, now - LOCK_WINDOW_MS)
    .first<{ n: number; last: number | null }>();
  if (!row || row.n < LOCK_MAX_FAIL) return 0;
  return Math.max(1, Math.ceil(((row.last ?? now) + LOCK_WINDOW_MS - now) / 1000));
}

async function recordAttempt(env: Env, iph: string, ok: boolean): Promise<void> {
  const now = Date.now();
  await env.DB.prepare('INSERT INTO auth_attempts (ip_hash, ts, ok) VALUES (?, ?, ?)')
    .bind(iph, now, ok ? 1 : 0)
    .run()
    .catch(() => undefined);
  await env.DB.prepare('DELETE FROM auth_attempts WHERE ts < ?')
    .bind(now - 86_400_000)
    .run()
    .catch(() => undefined);
}

/** 发一封 6 位验证码。`purpose` 目前只用 login，bind / change_email 留给后续 */
export async function sendLoginCode(
  env: Env,
  request: Request,
  rawEmail: unknown,
  purpose = 'login',
): Promise<SendResult> {
  const email = normalizeEmail(rawEmail);
  if (!isEmail(email)) return { ok: false, reason: 'bad_email', message: '邮箱格式看起来不对' };

  const devMode = devCodeAllowed(request, env);
  if (!env.RESEND_KEY && !devMode) {
    return { ok: false, reason: 'mail', message: '发信通道还没开，先用别的方式联系站长吧' };
  }

  const iph = await ipHash(request, env);
  const locked = await lockRemain(env, iph);
  if (locked > 0) {
    return { ok: false, reason: 'locked', message: `试得太频繁了，${Math.ceil(locked / 60)} 分钟后再来`, retryAfter: locked };
  }

  const now = Date.now();

  // ① 同邮箱冷却
  const last = await env.DB.prepare(
    'SELECT sent_at AS sent_at FROM auth_codes WHERE email = ? ORDER BY sent_at DESC LIMIT 1',
  )
    .bind(email)
    .first<{ sent_at: number }>();
  if (last && now - last.sent_at < CODE_COOLDOWN_MS) {
    const wait = Math.ceil((CODE_COOLDOWN_MS - (now - last.sent_at)) / 1000);
    return { ok: false, reason: 'cooldown', message: `刚发过一封，${wait} 秒后再点一次`, retryAfter: wait };
  }

  // ② 同邮箱每日上限
  const day = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM auth_codes WHERE email = ? AND sent_at > ?',
  )
    .bind(email, now - 86_400_000)
    .first<{ n: number }>();
  if ((day?.n ?? 0) >= EMAIL_DAY_MAX) {
    return { ok: false, reason: 'limited', message: '这个邮箱今天收得够多了，明天再来 ~' };
  }

  // ③ 同 IP 每小时上限
  const hour = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM auth_codes WHERE ip_hash = ? AND sent_at > ?',
  )
    .bind(iph, now - 3_600_000)
    .first<{ n: number }>();
  if ((hour?.n ?? 0) >= IP_HOUR_MAX) {
    return { ok: false, reason: 'limited', message: '这一小时发得有点多，歇一会儿再来 ~' };
  }

  const code = randomCode();
  const salt = randomToken(16);
  const codeHash = await codeHashOf(env, purpose, email, code, salt);

  const account = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?')
    .bind(email)
    .first<{ id: number }>()
    .catch(() => null);

  const ins = await env.DB.prepare(
    `INSERT INTO auth_codes (email, account_id, code_hash, salt, purpose, ip_hash, sent_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(email, account?.id ?? null, codeHash, salt, purpose, iph, now, now + CODE_TTL_MS)
    .run();

  // 本地预览：不发信，把码直接回给前端（只有回环地址 + AUTH_DEV_CODE=1 才有）
  if (devMode) {
    console.log(`[auth][dev] ${email} 的验证码是 ${code}`);
    return { ok: true, devCode: code };
  }

  const sent = await sendMail(env, {
    to: email,
    subject: `清吾 · 登录验证码 ${code}`,
    text: [
      `你的验证码是 ${code}，5 分钟内有效。`,
      '',
      '没在清吾留过言？那可能是有人把邮箱填错了，忽略这封信就好。',
      '',
      `${siteUrl(env)}/links/`,
    ].join('\n'),
  });

  if (!sent) {
    // 发不出去就把码作废，别留一个「有效但没人收到」的记录
    await env.DB.prepare('DELETE FROM auth_codes WHERE id = ?')
      .bind(Number(ins.meta.last_row_id))
      .run()
      .catch(() => undefined);
    return { ok: false, reason: 'mail', message: '信没发出去，稍后再试一次' };
  }

  return { ok: true };
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'no_code' | 'bad_code' | 'expired' | 'locked'; message: string; left?: number };

/** 校验验证码。成功即把这条码标成已用 —— 同一条码不能登两次 */
export async function verifyLoginCode(
  env: Env,
  request: Request,
  rawEmail: unknown,
  rawCode: unknown,
  purpose = 'login',
): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode ?? '').replace(/\s/g, '');
  if (!isEmail(email) || !/^\d{6}$/.test(code)) {
    return { ok: false, reason: 'bad_code', message: '验证码是 6 位数字' };
  }

  const iph = await ipHash(request, env);
  const locked = await lockRemain(env, iph);
  if (locked > 0) {
    return { ok: false, reason: 'locked', message: `试得太频繁了，${Math.ceil(locked / 60)} 分钟后再来` };
  }

  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT id, code_hash, salt, tries, expires_at FROM auth_codes
      WHERE email = ? AND purpose = ? AND used = 0
      ORDER BY sent_at DESC LIMIT 1`,
  )
    .bind(email, purpose)
    .first<{ id: number; code_hash: string; salt: string; tries: number; expires_at: number }>();

  if (!row) return { ok: false, reason: 'no_code', message: '先点「发验证码」，再填收到的 6 位数字' };
  if (row.expires_at < now) return { ok: false, reason: 'expired', message: '这封验证码过期了，重新发一封吧' };
  if (row.tries >= CODE_MAX_TRIES) {
    return { ok: false, reason: 'bad_code', message: '这条码试错太多次了，重新发一封吧', left: 0 };
  }

  // 定长比较：同一套哈希口径算出来的两个 hex 串，用 secretEqual 走同一条路径
  const given = await codeHashOf(env, purpose, email, code, row.salt ?? '');
  if (!(await secretEqual(given, row.code_hash))) {
    await env.DB.prepare('UPDATE auth_codes SET tries = tries + 1 WHERE id = ?')
      .bind(row.id)
      .run()
      .catch(() => undefined);
    await recordAttempt(env, iph, false);
    const left = Math.max(0, CODE_MAX_TRIES - row.tries - 1);
    return {
      ok: false,
      reason: 'bad_code',
      message: left > 0 ? `验证码不对，还能试 ${left} 次` : '这条码用不了了，重新发一封吧',
      left,
    };
  }

  await env.DB.prepare('UPDATE auth_codes SET used = 1 WHERE id = ?').bind(row.id).run();
  await recordAttempt(env, iph, true);
  return { ok: true, email };
}

/** 只给日志 / 排障用：把 IP 说成可读形式，不落库 */
export function ipOf(request: Request): string {
  return clientIp(request);
}
