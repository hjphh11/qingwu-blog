// 清吾 · Worker 入口（极小路由）
//
// 已启用：
//   POST   /hit          访客上报 → D1
//   GET    /hit          能力探测（与旧的 /api/hit GET 同形）
//   GET    /stats        后台统计查询（需 Bearer 口令）
//   GET    /post-views   单篇阅读量（文章页头部，只认 /blog/ 开头）
//   GET    /site-summary 全站访问汇总（公开只读：totalPv + uniqueVisitors，首页足迹卡用）
//   GET    /link-status  友链展示状态（失联缓冲 / 违规整改 / 到期下架）
//   GET    /post-comments?path=/blog/<slug>   文章评论列表（写口见下方同名路由）
//   GET    /health       健康检查
//   POST   /apply        友链申请提交（第 2 步）
//   GET    /apply        无口令 = 能力探测；带口令 = 后台读列表
//   PATCH  /apply/:id    后台改审批状态（需 Bearer 口令）
//   GET    /chat/history 长亭（聊天室）历史 / /chat/poll 增量 / /chat/send 发送
//                        见 worker/src/chat/index.ts
//
// 第 3~5 步的路由（/comments、/likes、Cron）以后再加，别现在就把口子开着。

import { getApply, patchApply, postApply } from './apply';
import { handleAuth } from './auth/index';
import { handleAdmin } from './admin/index';
import { handleChat } from './chat/index';
import { purgeOrphanMedia } from './chat/media';
import { flushBridge } from './chat/bridge';
import { warmOnePeerName } from './chat/peerName';
import { hasLocalVisitors, pullBridge, setBridgePresence } from './chat/sync';
import { runBacklinkCheck } from './admin/friends';
import { deleteFriendComment, getFriendsBoard, postFriendLike, postFriendReply, postFriendsBoard } from './friends-board';
import { deletePostComment, getPostComments, postPostComment, postPostLike, postPostReply } from './post-comments';
import { getLinkPosts, getLinkStats, getLinkStatus, postLinkClick } from './link';
import { refreshAllFeeds } from './links-refresh';
import { flushOutbox } from './mail';
import { getHit, postHit } from './hit';
import { getPostViews } from './views';
import { getSiteSummary } from './summary';
import { getStats } from './stats';
import { json, originAllowed, parseOrigins } from './util';
import type { Env } from './types';

/** 允许的请求方法，用于 CORS 预检 */
const ALLOW_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
const ALLOW_HEADERS = 'content-type, authorization';

/**
 * 转发账号上一次设置过的 presence。
 *
 * 只用来省掉重复的 PUT：cron 每分钟都会跑，状态没变就没必要再打一次
 * （服务端虽然不会重复广播，但没必要每分钟都发一条请求）。进程重启后是 null，
 * 下一次 cron 会多设一次，无副作用。
 */
let bridgePresence: 'online' | 'offline' | null = null;

/** 处理 CORS 预检：/hit 与 /apply 都可能被浏览器直连，都要支持 */
function preflight(request: Request, env: Env): Response {
  const origin = request.headers.get('origin') || '';
  const headers: Record<string, string> = { 'access-control-allow-methods': ALLOW_METHODS, 'access-control-allow-headers': ALLOW_HEADERS };
  if (originAllowed(origin || null, parseOrigins(env.ALLOWED_ORIGINS))) {
    headers['access-control-allow-origin'] = origin;
    // 带 cookie 的跨源请求要求这一行，否则浏览器直接拦掉（同源 /api 用不到）
    headers['access-control-allow-credentials'] = 'true';
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
      // 只回「活着」。以前带 `service: 'qingwu-api'`，等于给扫描器一个免费指纹
      return json({ ok: true });
    }

    /**
     * CSP 违规上报口（`report-uri /api/csp-report` + `Report-To: csp`）。
     *
     * 收下就回 204，不落库、不回显 —— 上报体里带完整 URL，可能含查询串，
     * 存下来反而是新的隐私面。只想在日志里看到「哪条规则在打架」时够用了。
     * 没有这条路由时，浏览器每页都会打一次 404，日志会被刷满。
     */
    if (path === '/csp-report') {
      if (request.method !== 'POST') return new Response(null, { status: 204 });
      try {
        const raw = await request.text();
        if (raw && raw.length < 8_000) console.warn('[csp] 违规上报:', raw.slice(0, 1_500));
      } catch {
        /* 读不出来也无所谓：上报不该影响任何东西 */
      }
      return new Response(null, { status: 204 });
    }

    // —— 统一身份（登录 / 绑定 / 我的留言）——
    // 对外是 /api/auth/*；nginx 的 location /api/ 去前缀转发到这里，
    // 且 /api/auth/ 不在 Basic Auth 的范围内 —— **nginx 零改动**。
    // 设计见 docs/方案-统一身份-登录与绑定.md。
    if (path.startsWith('/auth/')) return handleAuth(request, env, path);

    // —— 长亭（聊天室）——
    // 对外 /api/chat/*，同 auth 一样由 nginx 去前缀。设计见 docs/方案-聊天室.md。
    // ⚠️ 必须带斜杠：`/chat/` 而不是 `/chat`，否则将来加个 /chatterbox 之类会被误吞。
    if (path.startsWith('/chat/')) return handleChat(request, env, ctx, path);

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

    // —— 文章评论（每篇文章下面，post_slug = '/blog/<slug>'）——
    // 和友链评论区共用 comments 表与实现（worker/src/comments.ts），只是分区不同：
    // 登录 / 限流 / 审核 / 点赞 / 删除全是一套，没有第二套账号体系。
    if (path === '/post-comments') {
      if (request.method === 'GET') return getPostComments(request, env);
      if (request.method === 'POST') return postPostComment(request, env, ctx);
      return json({ ok: false, reason: 'method_not_allowed' }, 405);
    }
    const pcDel = path.match(/^\/post-comments\/(\d+)$/);
    if (pcDel && request.method === 'DELETE') {
      return deletePostComment(request, env, pcDel[1]);
    }
    const pc = path.match(/^\/post-comments\/(\d+)\/(reply|like)$/);
    if (pc) {
      if (request.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);
      return pc[2] === 'reply'
        ? postPostReply(request, env, ctx, pc[1])
        : postPostLike(request, env, pc[1]);
    }

    // —— 单篇阅读量（文章页头部那个数字）——
    // 公开只读、只认 /blog/ 开头的路径，缓存 120s；见 views.ts 顶部的说明。
    if (path === '/post-views') {
      if (request.method !== 'GET') return json({ ok: false, reason: 'method_not_allowed' }, 405);
      return getPostViews(request, env);
    }

    // —— 全站访问汇总（首页「悄悄收藏的脚印」）——
    // 公开只读、只回两个整数，缓存 60s；见 summary.ts 顶部的三条边界。
    if (path === '/site-summary') {
      if (request.method !== 'GET') return json({ ok: false, reason: 'method_not_allowed' }, 405);
      return getSiteSummary(request, env);
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
    /**
     * 这个 handler 现在是**每分钟**被调一次（服务器 crontab `* * * * *`），
     * 所以重活要自己判断「今天跑过没有」——不然回链轮检会每分钟去抓十几个第三方站。
     * 03:00 那一次额外跑：友链探测、回链轮检、媒体清理。
     */
    const clock = new Date();
    const daily = clock.getHours() === 3 && clock.getMinutes() === 0;

    if (daily) {
      ctx.waitUntil(
        refreshAllFeeds(env)
          .then((s) => console.log(`[cron] 友链更新探测：${s.updated}/${s.total} 命中，${s.failed} 未抓到`))
          .catch((err) => console.error('[cron] 友链更新探测失败:', err instanceof Error ? err.message : err)),
      );
      // 回链轮检：每天一次，串行抓十几个第三方站点（见 admin/friends.ts 里为什么串行）
      ctx.waitUntil(
        runBacklinkCheck(env)
          .then((s) => console.log(`[cron] 回链检查：${s.ok}/${s.total} 仍挂着回链`))
          .catch((err) => console.error('[cron] 回链检查失败:', err instanceof Error ? err.message : err)),
      );
      // 长亭媒体清理：只清「没有 visible/pending 消息引用」且超过 7 天的图/语音。
      // 别改成按前缀的 R2 lifecycle —— 那条规则不认识库，会把在用的历史图一起删成破图。
      ctx.waitUntil(
        purgeOrphanMedia(env)
          .then((s) => {
            if (s.removed || s.failed) console.log(`[cron] 长亭媒体清理：删 ${s.removed} 个，失败 ${s.failed}`);
          })
          .catch((err) => console.error('[cron] 长亭媒体清理失败:', err instanceof Error ? err.message : err)),
      );
    }

    ctx.waitUntil(
      flushOutbox(env, 10).catch((err) =>
        console.error('[cron] 补发通知信失败:', err instanceof Error ? err.message : err),
      ),
    );
    // 茶室互联出站：发送成功时已经催过一次，这里兜住重试与积压（没配 MATRIX_* 时直接返回）
    ctx.waitUntil(
      flushBridge(env)
        .then((s) => {
          if (s.sent || s.failed) console.log(`[cron] 互联出站：成功 ${s.sent}，丢弃 ${s.dropped}，失败 ${s.failed}`);
        })
        .catch((err) => console.error('[cron] 互联出站失败:', err instanceof Error ? err.message : err)),
    );
    // 互联站点的名字：每分钟补一个（去对方首页捞 <title>，缓存 7 天）。
    // 放在 cron 而不是 who 里，是因为 who 是 30 秒一次的热接口，现抓 8 个网页会把它拖死。
    ctx.waitUntil(
      warmOnePeerName(env)
        .then((r) => {
          if (r) console.log(`[cron] 互联站名：${r}`);
        })
        .catch((err) => console.error('[cron] 互联站名失败:', err instanceof Error ? err.message : err)),
    );
    // 茶室互联入站：拉一次 /sync，把大厅里别人的新消息收进来（首轮只记游标，不回灌历史）
    ctx.waitUntil(
      (async () => {
        const s = await pullBridge(env);
        if (s.first) console.log('[cron] 互联入站：已对齐游标（不回灌历史）');
        else if (s.added || s.redacted || s.reacted)
          console.log(
            `[cron] 互联入站：新增 ${s.added} 条，撤回 ${s.redacted} 条，表情 ${s.reacted} 个，跳过 ${s.skipped}`,
          );
        /**
         * 站内一个人都没有 ⇒ 转发账号也别在大厅里亮着。
         *
         * 必须放在 sync **之后**：任何一次 `/sync` 都会把它标成 online
         * （`set_presence=offline` 对这台 Synapse 无效，见 `setBridgePresence` 的注释）。
         * 有人回来时 poll 会立刻再 sync 一次，presence 自己就恢复到 online。
         */
        const local = await hasLocalVisitors(env, Date.now());
        if (!local) {
          /**
           * ⚠️ **每分钟都得 PUT 一次**，不能因为「上次已经设过 offline」就跳过：
           * 上面那行 `pullBridge` 里的 `/sync` 每次都把账号刷成 online，
           * 守卫一加，第二分钟起 presence 就会卡在 online。
           * 重复 PUT 同一个值服务端不会重复广播，代价可以忽略。
           */
          const ok = await setBridgePresence(env, 'offline');
          if (ok) {
            if (bridgePresence !== 'offline') console.log('[cron] 长亭没人了，转发账号已下线');
            bridgePresence = 'offline';
          }
        } else if (bridgePresence !== 'online') {
          // 不用单独 PUT：刚跑完的 sync 已经把它标成 online 了
          bridgePresence = 'online';
          console.log('[cron] 长亭有人，转发账号在线');
        }
      })().catch((err) => console.error('[cron] 互联入站失败:', err instanceof Error ? err.message : err)),
    );
  },
} satisfies ExportedHandler<Env>;
