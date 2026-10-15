// 清吾 · Worker 入口（极小路由）
//
// 第 1 步只开放三条路由：
//   POST /hit     访客上报 → D1
//   GET  /hit     能力探测（与旧的 /api/hit GET 同形）
//   GET  /stats   后台统计查询（需 Bearer 口令）
//   GET  /health  健康检查
//
// 第 2~5 步的路由（/apply、/comments、/likes、Cron）以后再加，别现在就把口子开着。

import { getHit, postHit } from './hit';
import { getStats } from './stats';
import { json, originAllowed, parseOrigins } from './util';
import type { Env } from './types';

/** 允许的请求方法，用于 CORS 预检 */
const ALLOW_METHODS = 'GET, POST, OPTIONS';
const ALLOW_HEADERS = 'content-type, authorization';

/** 处理 CORS 预检：只有 /hit 需要（站点默认走同源转发，用不到；留着给浏览器直连的场景） */
function preflight(request: Request, env: Env): Response {
  const origin = request.headers.get('origin') || '';
  const headers: Record<string, string> = { 'access-control-allow-methods': ALLOW_METHODS, 'access-control-allow-headers': ALLOW_HEADERS };
  if (originAllowed(origin || null, parseOrigins(env.ALLOWED_ORIGINS))) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-max-age'] = '86400';
  }
  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // 容忍结尾斜杠：/hit/ 与 /hit 等价
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return preflight(request, env);

    if (path === '/health') {
      return json({ ok: true, service: 'qingwu-api', time: new Date().toISOString() });
    }

    if (path === '/hit') {
      if (request.method === 'POST') return postHit(request, env, ctx);
      if (request.method === 'GET') return getHit(env);
      return json({ ok: false, reason: 'bad_request' }, 405);
    }

    if (path === '/stats') {
      if (request.method !== 'GET') return json({ enabled: false, empty: true, reason: 'method_not_allowed' }, 405);
      try {
        return await getStats(request, env);
      } catch (err) {
        // 兜底：路由里任何没预料到的异常都是通用 5xx，不泄露内部信息
        console.error('[worker] /stats 未处理异常:', err instanceof Error ? err.message : err);
        return json({ enabled: false, empty: true, reason: '统计服务暂时不可用，稍后再试' }, 503);
      }
    }

    return json({ ok: false, reason: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
