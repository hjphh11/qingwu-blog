// 清吾 · 友链申请（第 2 步迁移）—— 前台提交与后台审批都落 D1
//
// 路由：
//   POST /apply            前台提交申请（Turnstile + 去重 + 基本频率限制）
//   GET  /apply            能力探测（不带口令）：{ enabled }
//   GET  /apply            后台读列表（带 Bearer 口令）：全部申请
//   PATCH /apply/:id       后台改状态（Bearer 口令）：approved | rejected | pending
//
// **鉴权是硬边界**：列表与改状态都必须带 `ADMIN_APPLY_TOKEN` 的 Bearer 口令。
// 申请里含访客邮箱，是隐私数据 —— 不带口令一律 401，连条数都不给。
//
// 为什么改状态要单独一个 secret（而不是复用 ADMIN_STATS_TOKEN）：
// 统计口令泄漏最多暴露访问量，申请口令泄漏会暴露访客邮箱。分开配、分开轮换。
//
// 与旧实现（私有仓库 applications.json）的**语义对齐**：
//   · 去重规则：同 url（规范化后）或同邮箱，已有 pending|approved → 409；
//     24 小时内重复提交 → 409；status=rejected 不算重复，对方可以重新申请。
//   · id 沿用 `app-<base36 时间>-<5 位随机>` 格式，便于和旧日志/链接对照。

import type { Env } from './types';
import { json, secretEqual } from './util';

/** 同一邮箱/网站在这个窗口内重复提交会被判定为重复（与旧 `applyStore.ts` 一致） */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** 字段长度上限 —— 与 `src/lib/applyValidation.ts` 的 APPLY_LIMITS 保持一致 */
const LIMITS = { name: 30, intro: 60, url: 300, avatar: 300, shot: 400, email: 254 };

/** 简单频率限制：同一 IP 哈希 10 分钟内最多 5 次提交（D1 计数，不依赖 Upstash） */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

interface ApplyBody {
  name?: unknown;
  url?: unknown;
  avatar?: unknown;
  shot?: unknown;
  intro?: unknown;
  email?: unknown;
  turnstileToken?: unknown;
  hp?: unknown;
  elapsedMs?: unknown;
}

interface AppRow {
  id: number;
  name: string;
  url: string;
  avatar: string | null;
  intro: string | null;
  email: string | null;
  status: string;
  reason: string | null;
  created_at: number;
  handled_at: number | null;
}

// ——————————————————————————————————————————————————————————
// 校验与规范化（与前端共用同一套规则，前端被绕过也兜得住）
// ——————————————————————————————————————————————————————————
const URL_RE = /^https?:\/\/[^\s/]+\.[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeUrl(raw: string): string {
  const t = (raw || '').trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** 同一站点的比较键：忽略协议、www、大小写、结尾斜杠 —— 与旧 `urlKey()` 一致 */
function urlKey(raw: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

function validate(v: { name: string; url: string; avatar: string; intro: string; shot: string; email: string }) {
  const e: Record<string, string> = {};
  if (!v.name) e.name = '请填写站点名称';
  else if (v.name.length > LIMITS.name) e.name = `名称最多 ${LIMITS.name} 个字`;
  if (!v.url) e.url = '请填写站点地址';
  else if (!URL_RE.test(v.url)) e.url = '地址看起来不对（需要 http:// 或 https:// 开头）';
  else if (v.url.length > LIMITS.url) e.url = '地址太长了';
  if (v.avatar && !URL_RE.test(v.avatar)) e.avatar = '头像地址看起来不对';
  // 站点照片选填：留空不报错，填了必须是链接且不超长
  if (v.shot) {
    if (v.shot.length > LIMITS.shot) e.shot = '照片链接太长了';
    else if (!URL_RE.test(v.shot)) e.shot = '照片地址看起来不对';
  }
  if (v.intro.length > LIMITS.intro) e.intro = `介绍最多 ${LIMITS.intro} 个字`;
  if (v.email && !EMAIL_RE.test(v.email)) e.email = '邮箱格式看起来不对';
  return e;
}

// ——————————————————————————————————————————————————————————
// 记录 → API 形状（**字段名与旧 applications.json 逐字一致**，后台前端不用改）
// ——————————————————————————————————————————————————————————
/** API 形状的申请（字段名与旧 applications.json 逐字一致，后台前端不用改） */
interface ApiApplication {
  id: string;
  name: string;
  url: string;
  avatar: string;
  intro: string;
  email: string;
  submittedAt: string;
  status: string;
  reviewedAt: string | null;
  reason: string | null;
}

function toApi(row: AppRow): ApiApplication {
  return {
    id: `d1-${row.id}`, // 前缀标明来源，避免和旧 `app-xxx` 撞名
    name: row.name,
    url: row.url,
    avatar: row.avatar ?? '',
    intro: row.intro ?? '',
    email: row.email ?? '',
    submittedAt: new Date(row.created_at).toISOString(),
    status: row.status,
    reviewedAt: row.handled_at ? new Date(row.handled_at).toISOString() : null,
    reason: row.reason,
  };
}

/** 取真实访客 IP（Cloudflare 注入，比 Vercel 的 clientAddress 更可信） */
function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** 匿名 IP 标识，只用于计数与去重，不落明文 */
async function ipKey(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${ip}`);
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** 人机验证接口超时：Turnstile 响应慢时必须尽快判失败，不能把提交请求一起拖死 */
const TURNSTILE_TIMEOUT_MS = 4000;

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  if (!secret) return false;
  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (ip && ip !== 'unknown') form.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

// ——————————————————————————————————————————————————————————
// POST /apply —— 前台提交
// ——————————————————————————————————————————————————————————
export async function postApply(request: Request, env: Env): Promise<Response> {
  if (!env.TURNSTILE_SECRET) {
    return json({ error: 'unavailable', message: '提交通道还没开放' }, 503);
  }

  let body: ApplyBody;
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    return json({ error: 'bad_request', message: '请求格式不对' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'bad_request', message: '请求格式不对' }, 400);
  }

  // —— 0. 蜜罐：正常访客看不到这个隐藏字段 ——
  // 假装成功、不落库、不发信，让脚本拿不到反馈。
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    console.warn('[apply] 蜜罐命中，已忽略该提交');
    return json({ ok: true, id: 'ignored', notified: false });
  }

  // shot（站点照片）是选填：留空合法，填了才补协议头
  const shotRaw = String(body.shot ?? '').trim();
  const values = {
    name: String(body.name ?? '').trim(),
    url: normalizeUrl(String(body.url ?? '')),
    avatar: normalizeUrl(String(body.avatar ?? '')),
    intro: String(body.intro ?? '').trim(),
    shot: shotRaw ? normalizeUrl(shotRaw) : '',
    email: String(body.email ?? '').trim(),
  };

  const errors = validate(values);
  if (Object.keys(errors).length > 0) {
    return json({ error: 'validation', fields: errors }, 400);
  }

  // —— 1. 人机验证 ——
  const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';
  if (!token) return json({ error: 'turnstile', message: '请先完成人机验证' }, 403);

  const ip = clientIp(request);
  // 本地 wrangler dev 的出网受限（workerd 到不了 challenges.cloudflare.com），
  // 联调时用 DEV_SKIP_TURNSTILE 跳过网络校验。**只在 .dev.vars 里配，线上没有这个变量。**
  const devSkip = env.DEV_SKIP_TURNSTILE === '1';
  if (!devSkip && !(await verifyTurnstile(env.TURNSTILE_SECRET, token, ip))) {
    return json({ error: 'turnstile', message: '人机验证没通过，请刷新后重试' }, 403);
  }

  const db = env.DB;
  const now = Date.now();

  // —— 2. 基本频率限制（D1 计数；Upstash 那套精细限流仍在 Vercel 侧）——
  if (env.HIT_IP_SALT) {
    const key = await ipKey(ip, env.HIT_IP_SALT);
    const since = now - RATE_WINDOW_MS;
    const cnt = await db
      .prepare('SELECT COUNT(*) AS n FROM applications WHERE ip_key = ? AND created_at > ?')
      .bind(key, since)
      .first<{ n: number }>();
    if ((cnt?.n ?? 0) >= RATE_MAX) {
      return json(
        {
          error: 'rate_limited',
          scope: 'ip-window',
          message: '提交得有点频繁，先歇一会儿再来吧 ~',
        },
        429,
        { 'retry-after': String(Math.ceil(RATE_WINDOW_MS / 1000)) },
      );
    }
  }

  // —— 3. 去重（同 url 或同邮箱，status != rejected）——
  const k = urlKey(values.url);
  const dup = await db
    .prepare(
      `SELECT id, url, email, status, created_at FROM applications
       WHERE status != 'rejected' AND (LOWER(url) = LOWER(?) OR LOWER(email) = LOWER(?))
       LIMIT 5`,
    )
    .bind(values.url, values.email)
    .all<{ id: number; url: string; email: string | null; status: string; created_at: number }>();

  for (const row of dup.results ?? []) {
    const sameSite = k && urlKey(row.url) === k;
    const sameEmail = values.email && (row.email ?? '').trim().toLowerCase() === values.email.toLowerCase();
    if (sameSite) {
      return json({ error: 'duplicate', message: '这个站点已经在申请列表里了，我这就去看 ~' }, 409);
    }
    if (sameEmail) {
      return json({ error: 'duplicate', message: '这个邮箱的申请已经收到了，不用重复提交 ~' }, 409);
    }
  }
  // 24 小时冷却：即便 status 是 rejected，短时间内反复提交也挡一下
  const fresh = await db
    .prepare('SELECT id FROM applications WHERE created_at > ? AND (LOWER(url) = LOWER(?) OR LOWER(email) = LOWER(?)) LIMIT 1')
    .bind(now - COOLDOWN_MS, values.url, values.email)
    .first<{ id: number }>();
  if (fresh) {
    return json({ error: 'duplicate', message: '刚刚已经收到过你的申请了，稍等我看一下 ~' }, 409);
  }

  // —— 4. 落库 ——
  const ipKeyVal = env.HIT_IP_SALT ? await ipKey(ip, env.HIT_IP_SALT) : null;
  try {
    const res = await db
      .prepare(
        `INSERT INTO applications (name, url, avatar, intro, shot, email, status, created_at, ip_key)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(values.name, values.url, values.avatar, values.intro, values.shot, values.email, now, ipKeyVal)
      .run();
    const id = `d1-${res.meta.last_row_id}`;
    return json({ ok: true, id, notified: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // UNIQUE(url) 撞了 = 并发提交同一站点
    if (/UNIQUE/i.test(msg)) {
      return json({ error: 'duplicate', message: '这个站点已经在申请列表里了，我这就去看 ~' }, 409);
    }
    console.error('[apply] 落库失败:', msg);
    return json({ error: 'storage', message: '申请暂时存不进去，请稍后重试或直接邮件联系我' }, 502);
  }
}

// ——————————————————————————————————————————————————————————
// GET /apply —— 能力探测（无口令）或列表（有口令）
// ——————————————————————————————————————————————————————————
export async function getApply(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  // 没带口令 → 只回答「能不能提交」，绝不吐数据
  if (!token) {
    return json({ enabled: Boolean(env.TURNSTILE_SECRET) });
  }
  if (!env.ADMIN_APPLY_TOKEN || !(await secretEqual(token, env.ADMIN_APPLY_TOKEN))) {
    return json({ enabled: false, reason: '未授权：请带正确的 Authorization: Bearer 口令' }, 401);
  }

  const rows = await env.DB.prepare(
    `SELECT id, name, url, avatar, intro, email, status, reason, created_at, handled_at
     FROM applications
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
              created_at DESC`,
  ).all<AppRow>();

  const items: ApiApplication[] = (rows.results ?? []).map(toApi);
  return json({
    enabled: true,
    repo: 'cloudflare-d1',
    path: 'applications',
    items,
    counts: {
      pending: items.filter((a) => a.status === 'pending').length,
      approved: items.filter((a) => a.status === 'approved').length,
      rejected: items.filter((a) => a.status === 'rejected').length,
      total: items.length,
    },
    fetchedAt: new Date().toISOString(),
  });
}

// ——————————————————————————————————————————————————————————
// PATCH /apply/:id —— 后台改状态
// ——————————————————————————————————————————————————————————
export async function patchApply(request: Request, env: Env, idParam: string): Promise<Response> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!env.ADMIN_APPLY_TOKEN || !(await secretEqual(token, env.ADMIN_APPLY_TOKEN))) {
    return json({ enabled: false, reason: '未授权：请带正确的 Authorization: Bearer 口令' }, 401);
  }

  let body: { status?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as { status?: unknown; reason?: unknown };
  } catch {
    return json({ error: 'bad_request', message: '请求格式不对' }, 400);
  }

  const status = String(body.status ?? '');
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return json({ error: 'bad_request', message: 'status 只能是 pending / approved / rejected' }, 400);
  }

  const numericId = Number(String(idParam).replace(/^d1-/, ''));
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return json({ error: 'not_found', message: '找不到这条申请' }, 404);
  }

  const reason = status === 'rejected' ? String(body.reason ?? '').trim().slice(0, 200) || null : null;
  const handledAt = status === 'pending' ? null : Date.now();

  const res = await env.DB.prepare(
    'UPDATE applications SET status = ?, reason = ?, handled_at = ? WHERE id = ?',
  )
    .bind(status, reason, handledAt, numericId)
    .run();

  if (!res.meta.changes) {
    return json({ error: 'not_found', message: '找不到这条申请（列表可能已经刷新）' }, 404);
  }

  const row = await env.DB.prepare(
    'SELECT id, name, url, avatar, intro, email, status, reason, created_at, handled_at FROM applications WHERE id = ?',
  )
    .bind(numericId)
    .first<AppRow>();

  return json({ ok: true, application: row ? toApi(row) : null });
}
