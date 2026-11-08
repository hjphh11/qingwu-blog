// 清吾 · Worker 入口（极小路由）
//
// 已启用：
//   POST   /hit          访客上报 → D1
//   GET    /hit          能力探测（与旧的 /api/hit GET 同形）
//   GET    /stats        后台统计查询（需 Bearer 口令）
//   GET    /health       健康检查
//   POST   /apply        友链申请提交（第 2 步）
//   GET    /apply        无口令 = 能力探测；带口令 = 后台读列表
//   PATCH  /apply/:id    后台改审批状态（需 Bearer 口令）
//
// 第 3~5 步的路由（/comments、/likes、Cron）以后再加，别现在就把口子开着。

import { getApply, patchApply, postApply } from './apply';
import { deleteFriendComment, getFriendsBoard, postFriendLike, postFriendReply, postFriendsBoard } from './friends-board';
import { getLinkStats, postLinkClick } from './link';
import { refreshAllFeeds } from './links-refresh';
import { getHit, postHit } from './hit';
import { getStats } from './stats';
import { json, originAllowed, parseOrigins } from './util';
import type { Env } from './types';

/** 允许的请求方法，用于 CORS 预检 */
const ALLOW_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
const ALLOW_HEADERS = 'content-type, authorization';

/** 处理 CORS 预检：/hit 与 /apply 都可能被浏览器直连，都要支持 */
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

    // —— 友链申请（第 2 步）——
    if (path === '/apply') {
      if (request.method === 'POST') return postApply(request, env);
      if (request.method === 'GET') return getApply(request, env);
      return json({ ok: false, reason: 'method_not_allowed' }, 405);
    }
    // /apply/:id —— 只支持 PATCH（后台改状态）
    const applyId = path.startsWith('/apply/') ? path.slice('/apply/'.length) : '';
    if (applyId) {
      if (request.method === 'PATCH') return patchApply(request, env, applyId);
      return json({ ok: false, reason: 'method_not_allowed' }, 405);
    }

    if (path === '/link-click') {
      if (request.method === 'POST') return postLinkClick(request, env);
      return json({ ok: false, reason: 'method_not_allowed' }, 405);
    }

    if (path === '/link-stats') {
      if (request.method !== 'GET') return json({ ok: false, reason: 'method_not_allowed' }, 405);
      return getLinkStats(request, env, ctx);
    }

    // —— 友链评论区（留言 / 回复 / 点赞）——
    if (path === '/friends-board') {
      if (request.method === 'GET') return getFriendsBoard(request, env);
      if (request.method === 'POST') return postFriendsBoard(request, env, ctx);
      return json({ ok: false, reason: 'method_not_allowed' }, 405);
    }
    const fbDel = path.match(/^\/friends-board\/(\d+)$/);
    if (fbDel && request.method === 'DELETE') {
      return deleteFriendComment(request, env, fbDel[1]);
    }
    const fb = path.match(/^\/friends-board\/(\d+)\/(reply|like)$/);
    if (fb) {
      if (request.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);
      return fb[2] === 'reply'
        ? postFriendReply(request, env, ctx, fb[1])
        : postFriendLike(request, env, fb[1]);
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

  /**
   * 定时任务：每天把友链的「最近更新」重探一遍。
   * 真正的兜底是 /link-stats 里那次机会式刷新 —— cron 只是保证长期没人访问也会更新。
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      refreshAllFeeds(env)
        .then((s) => console.log(`[cron] 友链更新探测：${s.updated}/${s.total} 命中，${s.failed} 未抓到`))
        .catch((err) => console.error('[cron] 友链更新探测失败:', err instanceof Error ? err.message : err)),
    );
  },
} satisfies ExportedHandler<Env>;
