// 清吾 · Worker 入口（极小路由）
//
// 已启用：
//   POST   /hit          访客上报 → D1
//   GET    /hit          能力探测（与旧的 /api/hit GET 同形）
//   GET    /stats        后台统计查询（需 Bearer 口令）
//   GET    /post-views   单篇阅读量（文章页头部，只认 /blog/ 开头）
//   GET    /link-status  友链展示状态（失联缓冲 / 违规整改 / 到期下架）
//   GET    /health       健康检查
//   POST   /apply        友链申请提交（第 2 步）
//   GET    /apply        无口令 = 能力探测；带口令 = 后台读列表
//   PATCH  /apply/:id    后台改审批状态（需 Bearer 口令）
//
// 第 3~5 步的路由（/comments、/likes、Cron）以后再加，别现在就把口子开着。

import { getApply, patchApply, postApply } from './apply';
import { handleAdmin } from './admin/index';
import { runBacklinkCheck } from './admin/friends';
import { deleteFriendComment, getFriendsBoard, postFriendLike, postFriendReply, postFriendsBoard } from './friends-board';
import { getLinkPosts, getLinkStats, getLinkStatus, postLinkClick } from './link';
import { refreshAllFeeds } from './links-refresh';
import { flushOutbox } from './mail';
import { getHit, postHit } from './hit';
import { getPostViews } from './views';
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

/** 归档只读判定：READONLY 为 "1"/"true" 时，写入一律 410 */
function isReadOnly(env: Env): boolean {
  const v = (env.READONLY || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // 容忍结尾斜杠：/hit/ 与 /hit 等价
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return preflight(request, env);

    // —— 归档只读 ——
    // Cloudflare 上那份 D1 自 2026-11-09 22:42 导出后已冻结（唯一主库是香港机本地 SQLite，
    // 见 docs/决策-数据主从.md）。但 api.qingwu.ink 这个 Custom Domain 还活着：
    // 旧缓存页面 / 外部脚本打过来，就会往死库里写，分叉了也看不出来。
    // 这里把写口全关，只留 GET/HEAD —— 观测还能做，数据回不去。
    // 开关只在 Cloudflare 那份配（secret READONLY），本地不配，行为不变。
    if (isReadOnly(env) && request.method !== 'GET' && request.method !== 'HEAD') {
      return json(
        {
          ok: false,
          reason: 'archived',
          message: '本站数据已迁至 https://www.qingwu.ink，此接口仅作只读归档',
        },
        410,
      );
    }

    if (path === '/health') {
      return json({ ok: true, service: 'qingwu-api', time: new Date().toISOString() });
    }

    // —— 后台（对外 /api/admin/*，nginx 去前缀后到这里）——
    // 说明见 docs/方案-后台-admin.md；路由表在 src/admin/index.ts。
    // 注意它排在归档只读判断之后 —— CF 那份 READONLY 时后台的写接口也会 410，这是对的。
    if (path.startsWith('/admin/')) return handleAdmin(request, env, path);

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

    // 友链各站的最新文章（「友文」页）—— 纯读，数据由 /link-stats 的机会式刷新顺手写入
    if (path === '/link-posts') {
      if (request.method !== 'GET') return json({ ok: false, reason: 'method_not_allowed' }, 405);
      return getLinkPosts(request, env);
    }

    // 友链的展示状态（失联缓冲 / 违规整改 / 已到期下架）—— 见 link.ts 的 getLinkStatus
    if (path === '/link-status') {
      if (request.method !== 'GET') return json({ ok: false, reason: 'method_not_allowed' }, 405);
      return getLinkStatus(request, env);
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

    // —— 单篇阅读量（文章页头部那个数字）——
    // 公开只读、只认 /blog/ 开头的路径，缓存 120s；见 views.ts 顶部的说明。
    if (path === '/post-views') {
      if (request.method !== 'GET') return json({ ok: false, reason: 'method_not_allowed' }, 405);
      return getPostViews(request, env);
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
   *
   * 顺手补发积压的通知信（发信失败会入 mail_outbox，见 mail.ts）。
   * 两条互不影响，各自 catch，别让死信队列把友链刷新拖下水。
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // 归档只读：cron 也停。CF 上那条 03:00 的定时任务原本每天写 link_feeds，
    // 不停掉的话死库会自己长出「更新」假象。
    if (isReadOnly(env)) {
      console.log('[cron] 归档只读模式，跳过友链刷新与补发');
      return;
    }
    ctx.waitUntil(
      refreshAllFeeds(env)
        .then((s) => console.log(`[cron] 友链更新探测：${s.updated}/${s.total} 命中，${s.failed} 未抓到`))
        .catch((err) => console.error('[cron] 友链更新探测失败:', err instanceof Error ? err.message : err)),
    );
    ctx.waitUntil(
      flushOutbox(env, 10).catch((err) =>
        console.error('[cron] 补发通知信失败:', err instanceof Error ? err.message : err),
      ),
    );
    // 回链轮检：每天一次，串行抓十几个第三方站点（见 admin/friends.ts 里为什么串行）
    ctx.waitUntil(
      runBacklinkCheck(env)
        .then((s) => console.log(`[cron] 回链检查：${s.ok}/${s.total} 仍挂着回链`))
        .catch((err) => console.error('[cron] 回链检查失败:', err instanceof Error ? err.message : err)),
    );
  },
} satisfies ExportedHandler<Env>;
