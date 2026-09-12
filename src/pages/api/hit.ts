// 访问打点（方案 §11 路线 B）。
//
//   GET  /api/hit   能力探测：返回 { enabled }。没配 Upstash 时前端就不用白打点了
//                   （也和 /api/links/apply 一样，方便排查「变量写错 → 静默不计数」）。
//   POST /api/hit   记一次访问。**永远返回 200**：打点失败绝不能影响访客，
//                   浏览器的 sendBeacon 也不看状态码，回 4xx/5xx 只会在控制台留噪音。
//
// 采集的计数写进 Upstash（和限流共用同一个库），由 GitHub Action 定时汇总成 stats.json。
export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from '../../lib/serverEnv';
import { collectHit, isBot, statsConfig } from '../../lib/stats';

const SALT = env('APPLY_IP_SALT');
const CFG = statsConfig();
/** 两个都要有：Upstash 用来存，SALT 用来匿名化访客（缺一个就只探测不采集）*/
const ENABLED = Boolean(CFG && SALT);

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
  if (isBot(ua)) return json({ ok: false, reason: 'bot' }); // 爬虫、监控、预览渲染都不算访客

  let ip = 'unknown';
  try {
    ip = clientAddress || 'unknown';
  } catch {
    /* 少数运行环境拿不到 IP，不影响 */
  }

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
    return json({ ok: r.counted, reason: r.reason });
  } catch (err) {
    // 计数失败只记服务端日志：访客那边什么都看不到
    console.error('[hit] 采集失败:', err);
    return json({ ok: false, reason: 'error' });
  }
};
