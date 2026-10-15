// 访问打点（方案 §11 路线 B）。**第 1 步迁移后**：这里变成一层薄转发。
//
//   GET  /api/hit   能力探测：返回 { enabled }。没配采集端时前端就不用白打点了
//                   （也和 /api/links/apply 一样，方便排查「变量写错 → 静默不计数」）。
//   POST /api/hit   记一次访问。**永远返回 200**：打点失败绝不能影响访客，
//                   浏览器的 sendBeacon 也不看状态码，回 4xx/5xx 只会在控制台留噪音。
//
// 数据往哪走（两条路，靠 `HIT_WORKER_URL` 切换）：
//   ① 配了 `HIT_WORKER_URL`（例如 https://api.qingwu.ink）→ **转发给 Cloudflare Worker**，
//      由它写 D1。前端仍然调同源 `/api/hit`，所以**不用改前端、也不用处理 CORS**。
//      Worker 挂了/超时 → 自动退回 ②，不丢数据。
//   ② 没配 → 保持原样写 Upstash（旧链路仍可用，随时可回退：把这个变量删掉即可）。
export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from '../../lib/serverEnv';
import { collectHit, isBot, statsConfig } from '../../lib/stats';

const SALT = env('APPLY_IP_SALT');
const CFG = statsConfig();
/** Upstash 那条旧路：两个都要有（Upstash 用来存，SALT 用来匿名化访客）*/
const LEGACY_ENABLED = Boolean(CFG && SALT);

/** 新的采集端（Cloudflare Worker）。**空 = 走旧的 Upstash 链路** */
// 读两个键：`PUBLIC_` 优先 —— Vite 对 `PUBLIC_` 前缀的变量会在**构建期静态内联**，
// 不依赖运行时的 process.env（Edge runtime 里根本没有 process.env，动态键的
// import.meta.env[key] 也不会被内联，这就是当初切不过去的原因）。
const WORKER_URL = (env('PUBLIC_HIT_WORKER_URL') || env('HIT_WORKER_URL') || 'https://api.qingwu.ink').replace(/\/$/, '');
/** 转发超时（毫秒）。Worker 有边缘缓存+就近接入，正常几十毫秒；超了就退回旧路 */
const WORKER_TIMEOUT_MS = 8000; // 2s 太紧：跨境 + Worker 冷启动 + D1 写，超时就会静默回退 Upstash

const ENABLED = Boolean(WORKER_URL) || LEGACY_ENABLED;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** 打点请求体（前端只发这两个字段）*/
interface HitBody {
  path?: unknown;
  referrer?: unknown;
}

/** Worker `/hit` 的响应（见 worker/src/hit.ts）*/
interface WorkerHitResult {
  ok?: unknown;
  reason?: unknown;
  counted?: unknown;
}

/**
 * 把这次访问转给 Worker。
 * 返回 null 表示「没转成功」—— 调用方会退回旧的 Upstash 链路。
 */
async function forwardToWorker(request: Request, body: HitBody, clientIp: string): Promise<Response | null> {
  try {
    const ua = request.headers.get('user-agent');
    const country = request.headers.get('x-vercel-ip-country');
    const xff = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const res = await fetch(`${WORKER_URL}/hit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 把访客的真实信息原样带给 Worker：国家/地区（Vercel 会注入）、UA、转发链上的 IP
        ...(ua ? { 'user-agent': ua } : {}),
        ...(country ? { 'x-vercel-ip-country': country } : {}),
        ...(xff ? { 'x-forwarded-for': xff } : {}),
        ...(realIp ? { 'x-real-ip': realIp } : clientIp !== 'unknown' ? { 'x-real-ip': clientIp } : {}),
      },
      body: JSON.stringify({ path: body.path, referrer: body.referrer }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });

    if (!res.ok) {
      // ⚠️ 临时诊断：这条分支原来是静默的，导致线上"转发不生效"完全没法排查。
      // 打出真实状态码与响应体（截断），定位完改成正常日志或删除。
      const bodyText = await res.text().catch(() => '');
      console.error('[hit-probe] Worker 返回非 2xx:', res.status, bodyText.slice(0, 300));
      return null; // 4xx/5xx：退回旧路（不把错误码透出去）
    }
    const data = (await res.json()) as WorkerHitResult;
    return json({
      ok: data?.ok === true,
      reason: typeof data?.reason === 'string' ? data.reason : undefined,
      mode: 'worker', build: 'probe-v1',
      counted: data?.counted === true,
    });
  } catch (err) {
    // Worker 不可达/超时/返回不是 JSON —— 只记服务端日志，然后退回旧路
    console.error('[hit] 转发 Worker 失败，回退 Upstash:', err instanceof Error ? err.message : err);
    return null;
  }
}

export const GET: APIRoute = async () => json({ enabled: ENABLED });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // ⚠️ 临时探针（定位转发为何不生效，定位完删除）：
  //   目的 1：验证这个函数的 console 输出到底会不会进 Vercel 运行日志
  //   目的 2：直接打印 WORKER_URL 的真值，不再靠推断
  console.log('[hit-probe] alive workerUrl=', JSON.stringify(WORKER_URL));
  if (!ENABLED) return json({ ok: false, reason: 'disabled' });

  // ⚠️ 别写 `as typeof body`：那时 body 被收窄成 null，类型会变成 null（astro check 会报 never）。
  let body: HitBody | null = null;
  try {
    body = (await request.json()) as HitBody;
  } catch {
    return json({ ok: false, reason: 'bad_request' });
  }

  const ua = request.headers.get('user-agent') || '';
  if (isBot(ua)) return json({ ok: false, reason: 'bot' }); // 爬虫、监控、预览渲染都不算访客

  // 访客 IP：拿不到也不影响（少数运行环境没有）；转发给 Worker 时用它兜底
  let ip = 'unknown';
  try {
    ip = clientAddress || 'unknown';
  } catch {
    /* 少数运行环境拿不到 IP，不影响 */
  }

  // ① 新路：交给 Worker（bot/去重/限流都在 Worker 里做，和旧链路同一套规则）
  if (WORKER_URL) {
    const forwarded = await forwardToWorker(request, body ?? {}, ip);
    if (forwarded) return forwarded;
    // 转发失败：如果旧路也没配，就只能回 error（依旧是 200，访客无感）
    if (!LEGACY_ENABLED) return json({ ok: false, reason: 'error', mode: 'worker', build: 'probe-v1' });
  }

  // ② 旧路：Upstash（保留原行为，未配置 HIT_WORKER_URL 时完全等价于迁移前）
  try {
    const r = await collectHit(
      CFG!,
      {
        path: typeof body?.path === 'string' ? body.path : '',
        referrer: typeof body?.referrer === 'string' ? body.referrer : '',
        ip,
        ua,
        country: request.headers.get('x-vercel-ip-country'),
      },
      SALT,
    );
    return json({ ok: r.counted, reason: r.reason, mode: 'upstash', build: 'probe-v1' });
  } catch (err) {
    // 计数失败只记服务端日志：访客那边什么都看不到
    console.error('[hit] 采集失败:', err);
    return json({ ok: false, reason: 'error', mode: 'upstash', build: 'probe-v1' });
  }
};
