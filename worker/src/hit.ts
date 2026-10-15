// 清吾 · POST/GET /hit —— 访客访问上报
//
// 旧的五层链路：
//   访客 → Vercel `/api/hit` → Upstash Redis → GitHub Action 每 6h 汇总 → 私有仓库 stats.json → 后台读文件
// 现在只留两层：
//   访客 → （站点同源 /api/hit 薄转发）→ 本 Worker → D1
//
// 契约（**与旧 `src/pages/api/hit.ts` 逐字段对照**）：
//   请求：POST，JSON `{ path: string, referrer: string }`（前端只发这两个字段）
//   响应：**永远 200**，体是 `{ ok: boolean, reason?: string }`
//         reason 取值与旧代码一致：'bot' | 'seen' | 'disabled' | 'bad_request' | 'error'
//   另加两个**兼容性字段**（旧前端不读，纯为排障）：`mode`、`counted`
//   GET：能力探测，返回 `{ enabled: boolean }`（旧代码就是这个）
//
// 打点失败绝不能影响访客：所有分支都回 200，只在服务端日志里记原因。
import type { Env } from './types';
import {
  countryOf,
  dayKey,
  deviceOf,
  isBot,
  json,
  normPath,
  originAllowed,
  parseOrigins,
  refHost,
  visitorHash,
} from './util';

/** 同一访客同一页在这个窗口内只记一次访问（刷新不会把数字刷上去）—— 与旧 `DEDUPE_SECONDS` 一致 */
const DEDUPE_SECONDS = 1800;
/** 同一访客两次访问的最小间隔（秒）：比上面短，用来挡「刷页面」式的脚本 */
const RATE_WINDOW_SECONDS = 60;
/** D1 里保留多少天的明细（超过就靠清理任务删掉，避免无限涨） */
const RETAIN_DAYS = 400;
/** 多久顺手清一次旧数据（按请求数做概率触发，个人站量级完全够） */
const CLEANUP_EVERY_N = 500;

/** `/hit` 的处理结果，落到响应体里 */
interface HitResult {
  ok: boolean;
  reason?: 'bot' | 'seen' | 'disabled' | 'bad_request' | 'error';
  mode?: 'd1';
  counted?: boolean;
}

const ok = (body: HitResult, headers: Record<string, string> = {}) => json(body, 200, headers);

/** 取访客 IP。Cloudflare 上 `CF-Connecting-IP` 由边缘写入，客户端伪造不了。 */
function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    // 本地 `wrangler dev` / 站点转发过来时用这两个
    request.headers.get('x-real-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0]!.trim() ||
    'unknown'
  );
}

/**
 * 取国家/地区代码。
 * 线上：`request.cf.country`（Cloudflare 提供）。
 * 本地 dev：`request.cf` 可能不存在 → 退回到转发方给的 `x-vercel-ip-country`（Vercel 站点那边有）。
 */
function countryOfRequest(request: Request, cf: IncomingRequestCfProperties | undefined): string {
  const fromCf = (cf as { country?: unknown } | undefined)?.country;
  if (fromCf) return countryOf(fromCf);
  return countryOf(request.headers.get('x-vercel-ip-country') || request.headers.get('x-country'));
}

/** 防刷 ①：同一访客在 RATE_WINDOW_SECONDS 内已经记过任何一次访问 → 直接丢。 */
async function rateLimited(env: Env, visitor: string, nowSec: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT ts FROM hits WHERE visitor = ?1 ORDER BY ts DESC LIMIT 1')
    .bind(visitor)
    .first<{ ts: number }>();
  return Boolean(row && nowSec - Number(row.ts) < RATE_WINDOW_SECONDS);
}

/** 防刷 ②：同一访客同一页在 DEDUPE_SECONDS 内已经记过 → 不重复计 PV（旧代码的同一条规则）。 */
async function alreadySeen(env: Env, visitor: string, path: string, nowSec: number): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT ts FROM hits WHERE visitor = ?1 AND path = ?2 ORDER BY ts DESC LIMIT 1',
  )
    .bind(visitor, path)
    .first<{ ts: number }>();
  return Boolean(row && nowSec - Number(row.ts) < DEDUPE_SECONDS);
}

/** 顺手清理过期明细。失败不影响打点（只是数据多留一会儿）。 */
async function cleanup(env: Env, nowSec: number): Promise<void> {
  try {
    await env.DB.prepare('DELETE FROM hits WHERE ts < ?1').bind(nowSec - RETAIN_DAYS * 86400).run();
  } catch (err) {
    console.error('[hit] 清理旧明细失败:', err instanceof Error ? err.message : err);
  }
}

/** 写一条访问明细 */
async function writeHit(
  env: Env,
  hit: { ts: number; day: string; path: string; referrer: string; country: string; device: string; visitor: string },
  ctx: ExecutionContext,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO hits (ts, day, path, referrer, country, device, visitor)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(hit.ts, hit.day, hit.path, hit.referrer, hit.country, hit.device, hit.visitor)
    .run();

  // 概率触发清理，不拖慢响应
  if (Math.random() * CLEANUP_EVERY_N < 1) ctx.waitUntil(cleanup(env, hit.ts));
}

/** GET /hit —— 能力探测（与旧代码同形：`{ enabled }`） */
export function getHit(env: Env): Response {
  return ok({ enabled: Boolean(env.HIT_IP_SALT), ok: Boolean(env.HIT_IP_SALT) } as unknown as HitResult);
}

export async function postHit(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origins = parseOrigins(env.ALLOWED_ORIGINS);
  const headers: Record<string, string> = {};
  const origin = request.headers.get('origin');
  if (origin && originAllowed(origin, origins)) headers['access-control-allow-origin'] = origin;

  // 没配盐就没法做匿名访客标识 —— 只探测不采集（旧代码缺 SALT 时同样只探测）
  if (!env.HIT_IP_SALT) return ok({ ok: false, reason: 'disabled' }, headers);

  if (!originAllowed(origin, origins)) return ok({ ok: false, reason: 'bad_request' }, headers);

  // ⚠️ 请求体解析失败也必须回 200（sendBeacon 不看状态码，4xx/5xx 只会留噪音）
  let body: { path?: unknown; referrer?: unknown } | null = null;
  try {
    body = (await request.json()) as { path?: unknown; referrer?: unknown };
  } catch {
    return ok({ ok: false, reason: 'bad_request' }, headers);
  }

  const ua = request.headers.get('user-agent') || '';
  if (isBot(ua)) return ok({ ok: false, reason: 'bot' }, headers); // 爬虫、监控、预览渲染都不算访客

  const cf = (request as { cf?: IncomingRequestCfProperties }).cf;
  // 有些系统跑了无头浏览器，UA 看不出来；Cloudflare 的 bot score 能补一刀（拿不到就跳过）
  const botScore = (cf as { botManagement?: { score?: number } } | undefined)?.botManagement?.score;
  if (typeof botScore === 'number' && botScore < 30) return ok({ ok: false, reason: 'bot' }, headers);

  const nowSec = Math.floor(Date.now() / 1000);
  const day = dayKey(Date.now()); // 北京时间切天
  const path = normPath(body?.path);
  const referrer = refHost(body?.referrer);
  const country = countryOfRequest(request, cf);
  const device = deviceOf(ua);
  const visitor = await visitorHash(clientIp(request), ua, env.HIT_IP_SALT);

  try {
    if (await rateLimited(env, visitor, nowSec)) return ok({ ok: false, reason: 'seen' }, headers);
    if (await alreadySeen(env, visitor, path, nowSec)) return ok({ ok: false, reason: 'seen' }, headers);

    // 先回响应再落库（waitUntil）：访客永远不等数据库
    ctx.waitUntil(
      writeHit(env, { ts: nowSec, day, path, referrer, country, device, visitor }, ctx).catch((err) => {
        console.error('[hit] 写 D1 失败:', err instanceof Error ? err.message : err);
      }),
    );
    return ok({ ok: true, counted: true, mode: 'd1' }, headers);
  } catch (err) {
    // 计数失败只记服务端日志：访客那边什么都看不到（与旧代码一致）
    console.error('[hit] 采集失败:', err instanceof Error ? err.message : err);
    return ok({ ok: false, reason: 'error' }, headers);
  }
}
