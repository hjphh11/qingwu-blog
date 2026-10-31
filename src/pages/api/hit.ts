// 访问打点。**迁移完成后**：这里只剩「同源转发给 Cloudflare Worker」一件事。
//
//   GET  /api/hit   能力探测：返回 { enabled }，方便排查「变量写错 → 静默不计数」。
//   POST /api/hit   记一次访问。**永远返回 200**：打点失败绝不能影响访客，
//                   浏览器的 sendBeacon 也不看状态码，回 4xx/5xx 只会在控制台留噪音。
//
// 唯一的去向：`https://api.qingwu.ink/hit`（Cloudflare Worker → D1）。
//
// 历史：这条路由以前还会在 Worker 转发失败时**回退到 Upstash**（旧的 Vercel 链路，
// 再由 GitHub Action 每 6 小时汇总写私有仓库的 stats.json）。2026-10-31 核对过
// 两边数据：重叠的 37 天里 35 天逐日完全相同，且旧线自 10-18 起就没再产出新数据，
// 于是旧链路整条退役 —— 回退分支、stats.ts、stats-collect.mjs、stats.yml 一并删除。
// 现在 Worker 挂了就是少记一次访问，不再有第二条线兜底，这是刻意的取舍：
// 留着一条常年不产生数据的「备用线」只会让人误以为有兜底。
export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from '../../lib/serverEnv';

/** Worker 地址。`PUBLIC_` 优先 —— Vite 对 `PUBLIC_` 前缀的变量会在**构建期静态内联**，
 *  不依赖运行时的 process.env（Edge runtime 里根本没有 process.env）。 */
const WORKER_URL = (env('PUBLIC_HIT_WORKER_URL') || env('HIT_WORKER_URL') || 'https://api.qingwu.ink').replace(/\/$/, '');

/** 转发超时（毫秒）。Worker 有边缘缓存+就近接入，正常几十毫秒；
 *  8s 是给「跨境 + 冷启动 + D1 写」留的余量，别调回 2s（那样会大量假超时）。 */
const WORKER_TIMEOUT_MS = 8000;

const ENABLED = Boolean(WORKER_URL);

/** 只用于「明显是爬虫就别白跑一趟跨境请求」，判错也不影响数据正确性。
 *  Worker 侧自己也判一次，这里是省一次往返的早退。 */
const BOT_RE =
  /bot|crawler|spider|crawling|slurp|facebookexternalhit|embedly|quora link preview|pinterest|vkshare|whatsapp|telegrambot|headlesschrome|phantomjs|lighthouse|pagespeed|pingdom|uptime|monitor|curl|wget|python-requests|axios|go-http-client/i;

function isBot(ua: string): boolean {
  return !ua || BOT_RE.test(ua);
}

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
 * 返回 null 表示没转成功 —— 打点失败对访客不可见，只记日志。
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
      // ⚠️ 这条分支原来**静默 return null**，结果一次真实的 403（Cloudflare 挑战
      // 数据中心 IP）在线上完全看不到，排查时只能靠猜。关键失败路径必须留痕。
      const bodyText = await res.text().catch(() => '');
      console.error(`[hit] Worker 返回非 2xx：${res.status} ${bodyText.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as WorkerHitResult;
    return json({
      ok: data?.ok === true,
      reason: typeof data?.reason === 'string' ? data.reason : undefined,
      mode: 'worker',
      counted: data?.counted === true,
    });
  } catch (err) {
    // Worker 不可达/超时/返回不是 JSON —— 只记服务端日志，访客无感
    console.error('[hit] 转发 Worker 失败:', err instanceof Error ? err.message : err);
    return null;
  }
}

export const GET: APIRoute = async () => json({ enabled: ENABLED });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!ENABLED) return json({ ok: false, reason: 'disabled' });

  // ⚠️ 别写 `as typeof body`：那时 body 被收窄成 null，类型会变成 null（astro check 会报 never）。
  let body: HitBody | null = null;
  try {
    body = (await request.json()) as HitBody;
  } catch {
    return json({ ok: false, reason: 'bad_request' });
  }

  const ua = request.headers.get('user-agent') || '';
  // 爬虫、监控、预览渲染都不算访客。Worker 侧也判一次，这里早退省掉一次跨境请求。
  if (isBot(ua)) return json({ ok: false, reason: 'bot' });

  // 访客 IP：拿不到也不影响（少数运行环境没有）
  let ip = 'unknown';
  try {
    ip = clientAddress || 'unknown';
  } catch {
    /* 少数运行环境拿不到 IP，不影响 */
  }

  const forwarded = await forwardToWorker(request, body ?? {}, ip);
  if (forwarded) return forwarded;
  // 转发失败：依旧是 200，访客无感
  return json({ ok: false, reason: 'error', mode: 'worker' });
};
