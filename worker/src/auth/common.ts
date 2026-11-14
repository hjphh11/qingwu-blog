// 清吾 · 统一身份的公共工具
//
// 这里只放「不该有第二份实现」的东西：哈希、随机、cookie、IP、邮箱归一。
// 会话与账号语义在 store.ts，验证码在 codes.ts，路由在 index.ts。

import type { Env } from '../types';
import { originAllowed, parseOrigins } from '../util';

/** 会话 cookie。前台与后台共用 —— 后台额外要求 `kind='admin'` */
export const SESSION_COOKIE = 'q_sess';
/** GitHub OAuth 的 state cookie（短命，10 分钟） */
export const OAUTH_COOKIE = 'q_oauth';

export const SESSION_TTL_SEC = 30 * 86_400;

const enc = new TextEncoder();

export function hexOf(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of u8) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function sha256Hex(text: string): Promise<string> {
  return hexOf(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** 32 字节随机 token（十六进制 64 字符） */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return hexOf(buf);
}

/** 6 位数字验证码 —— 用 CSPRNG，不用 Math.random */
export function randomCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, '0');
}

/**
 * 取客户端 IP。
 *
 * ⚠️ **只信 `x-real-ip`**：它由 nginx 用 `$remote_addr` 覆盖写，客户端自带的同名头会被顶掉。
 * `cf-connecting-ip` / `x-forwarded-for` 在自建形态下（nginx → wrangler dev，没有
 * Cloudflare 边缘）都能被客户端自填 —— 一个请求头就能让 ipHash 每请求都不同，
 * 后台口令的失败锁定、验证码的发信上限、留言限流全部失效（2026-11-14 实测）。
 */
export function clientIp(request: Request): string {
  const real = (request.headers.get('x-real-ip') || '').trim();
  return real || '0.0.0.0';
}

export async function ipHash(request: Request, env: Env): Promise<string> {
  return (await sha256Hex(`${env.HIT_IP_SALT || 'no-salt'}|${clientIp(request)}`)).slice(0, 16);
}

export function readCookie(request: Request, name: string): string {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/**
 * 组 Set-Cookie。
 *
 * `Secure` 的判据：**先看 `x-forwarded-proto`**，再看 URL 协议。
 * 生产是 nginx → `http://127.0.0.1:8787` 反代，Worker 看到的 scheme 恒为 http，
 * 只按 URL 判断的话线上 cookie 永远拿不到 `Secure`（实测过）。
 * nginx 侧已补 `proxy_set_header X-Forwarded-Proto $scheme;`，这里据此还原真实协议。
 *
 * 本地 `wrangler dev` 直连 http://127.0.0.1:8787 时没有这个头 → 仍旧不加 Secure，
 * 否则浏览器会直接把 cookie 丢掉，表现为「登录成功但立刻又回未登录」。
 */
export function cookieOf(
  request: Request,
  name: string,
  value: string,
  maxAgeSec: number,
  path = '/',
): string {
  const forwarded = (request.headers.get('x-forwarded-proto') || '').split(',')[0]!.trim().toLowerCase();
  const proto = forwarded || new URL(request.url).protocol.replace(':', '');
  const secure = proto === 'https' ? '; Secure' : '';
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function clearCookieOf(request: Request, name: string, path = '/'): string {
  return cookieOf(request, name, '', 0, path);
}

/** 邮箱归一：**必须与 avatar.ts / md5.ts 的口径一致**，否则哈希对不上 */
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().slice(0, 254);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v);
}

/** 只露前 3 位 + 域名：145****@qq.com */
export function maskEmail(email: string): string {
  const [name, domain] = (email || '').split('@');
  if (!name || !domain) return '***';
  const head = name.slice(0, Math.min(3, Math.max(1, name.length - 1)));
  return `${head}****@${domain}`;
}

/** 开关型环境变量：默认开，只有明确的 off/0/false/no 才算关 */
export function isOn(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false' || v === 'no');
}

/** 与 friends-board.ts 里的同源判定同构 —— cookie 场景下必须带 credentials */
export function corsHeaders(request: Request, env: Env, extra: Record<string, string> = {}) {
  const origin = request.headers.get('origin') || '';
  const headers: Record<string, string> = { 'cache-control': 'no-store', ...extra };
  if (origin && originAllowed(origin, parseOrigins(env.ALLOWED_ORIGINS))) {
    headers['access-control-allow-origin'] = origin;
    // 前台走同源 /api，正常用不到；留这一行是为了「哪天浏览器直连 Worker」时 cookie 也能过
    headers['access-control-allow-credentials'] = 'true';
  }
  return headers;
}

/** 站点根地址 —— OAuth 回调与邮件里的链接都从这儿拼 */
export function siteUrl(env: Env): string {
  return (env.SITE_URL || 'https://www.qingwu.ink').replace(/\/$/, '');
}
