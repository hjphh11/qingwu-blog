// 清吾 · 友链点击统计
//
// 契约：
//   POST /link-click  body `{ url: string }`  → 永远 200，体 `{ ok, reason? }`
//   GET  /link-stats                          → `{ ok, items: { host: clicks } }`
//
// 两条和 /hit 一样的铁律：
//   1. **上报永远回 200** —— 统计失败绝不能拦住访客跳转（前端用的还是 sendBeacon，本来也不等结果）
//   2. **origin 白名单** —— 不是本站发来的就只回空数据
//
// 与 /hit 的区别：这里不做 IP 去重。
//   /hit 的「人次」是要写进首页卡片的，刷一下就变，必须去重；
//   友链点击是「有多少人点过这个站」，同一个 IP 十分钟内连点三次本来就该算三次
//   （他可能真的回去看了三趟）。代价是可能被刷，个人站量级不值得为此加一张去重表。
import type { Env } from './types';
import { maybeRefreshFeeds } from './links-refresh';
import { json, originAllowed, parseOrigins } from './util';

/** 上报结果统一回 200，原因只给排障用 */
interface ClickResult {
  ok: boolean;
  reason?: 'bad_request' | 'error';
}

function withCors(request: Request, env: Env) {
  const origin = request.headers.get('origin') || '';
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (origin && originAllowed(origin, parseOrigins(env.ALLOWED_ORIGINS))) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

/**
 * 把任意 URL 归一成一个主机名：去协议、去 www.、去端口、去路径。
 * 归一化是关键 —— 不归一的话 `https://a.com`、`http://a.com/`、`https://www.a.com/x`
 * 会变成三条互不相干的记录，点进去看统计全是 1。
 *
 * ⚠️ 必须容忍**不带协议**的输入（`a.com`）：
 *    前端上报传的一直是归一化后的主机名，`new URL('a.com')` 会直接抛
 *    `Invalid URL`，请求体被吞、接口回 200 + bad_request，统计静默不涨 ——
 *    这个坑线上跑了半天才发现（用 curl 传完整 URL 测是通的，所以没暴露）。
 */
function toHostKey(raw: string): string {
  const input = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const u = new URL(input);
  return u.host.replace(/^www\./i, '').toLowerCase();
}

/** POST /link-click */
export async function postLinkClick(request: Request, env: Env): Promise<Response> {
  const headers = withCors(request, env);

  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return json({ ok: false, reason: 'bad_request' } satisfies ClickResult, 200, headers);
  }

  const raw = String(body.url ?? '').trim();
  if (!raw || raw.length > 300) {
    return json({ ok: false, reason: 'bad_request' } satisfies ClickResult, 200, headers);
  }

  let key: string;
  try {
    key = toHostKey(raw);
  } catch {
    return json({ ok: false, reason: 'bad_request' } satisfies ClickResult, 200, headers);
  }

  const day = new Date().toISOString().slice(0, 10); // 按 UTC 分天，和 /hit 的 dayKey 一致

  try {
    await env.DB.prepare(
      `INSERT INTO link_clicks (url, day, clicks) VALUES (?, ?, 1)
       ON CONFLICT(url, day) DO UPDATE SET clicks = clicks + 1`,
    )
      .bind(key, day)
      .run();
    return json({ ok: true } satisfies ClickResult, 200, headers);
  } catch {
    return json({ ok: false, reason: 'error' } satisfies ClickResult, 200, headers);
  }
}

/**
 * GET /link-stats —— 点击总数 + 每个站的「最近更新」。
 *
 * 顺便做一件事：如果上次探测已经超过 12 小时，这里挂一个 waitUntil 去刷新。
 * 好处是**首次部署不必等到第二天 cron** —— 第一个访问友链页的人就把它跑出来了；
 * 坏处是这个请求会稍慢（waitUntil 不阻塞响应，所以其实不慢）。
 */
export async function getLinkStats(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const headers = withCors(request, env);

  const origin = request.headers.get('origin') || '';
  if (origin && !originAllowed(origin, parseOrigins(env.ALLOWED_ORIGINS))) {
    return json({ ok: false, items: {}, feeds: {}, shots: {} }, 200, headers);
  }

  try {
    const rows = await env.DB.prepare(
      `SELECT url, SUM(clicks) AS clicks FROM link_clicks GROUP BY url`,
    ).all<{ url: string; clicks: number }>();

    const items: Record<string, number> = {};
    for (const r of rows.results ?? []) {
      items[r.url] = Number(r.clicks) || 0;
    }

    // 最近更新时间：ok=0 的不回日期，前端据此不显示（抓不到 ≠ 很久没更新）
    // shots：站点代表图（og:image），和日期一起回，省一次往返
    const feeds: Record<string, string> = {};
    const shots: Record<string, string> = {};
    try {
      const frows = await env.DB.prepare(
        `SELECT url, last_updated, og_image FROM link_feeds`,
      ).all<{ url: string; last_updated: string | null; og_image: string | null }>();
      for (const r of frows.results ?? []) {
        if (r.last_updated) feeds[r.url] = r.last_updated;
        if (r.og_image) shots[r.url] = r.og_image;
      }
    } catch {
      // link_feeds 还没建（迁移未应用）—— 只回点击数，前端不显示更新日期
    }

    // 过期的就在后台补一轮，不拖慢这次响应
    if (ctx) ctx.waitUntil(maybeRefreshFeeds(env).catch(() => {}));

    return json({ ok: true, items, feeds, shots }, 200, headers);
  } catch {
    return json({ ok: false, items: {}, feeds: {}, shots: {} }, 200, headers);
  }
}

/**
 * GET /link-posts —— 友链各站最新文章的聚合列表（「友文」页）。
 *
 * 数据由 links-refresh 那趟抓取顺手写进 link_posts，这里只读。
 * 排序：有日期的按日期倒序在前，没日期的（feed 没给 pubDate）垫在后面。
 */
export async function getLinkPosts(request: Request, env: Env): Promise<Response> {
  const headers = withCors(request, env);

  const origin = request.headers.get('origin') || '';
  if (origin && !originAllowed(origin, parseOrigins(env.ALLOWED_ORIGINS))) {
    return json({ ok: false, items: [] }, 200, headers);
  }

  try {
    const rows = await env.DB.prepare(
      `SELECT url, host, title, published FROM link_posts
       ORDER BY (published IS NULL), published DESC, fetched_at DESC
       LIMIT 60`,
    ).all<{ url: string; host: string; title: string; published: string | null }>();

    return json({ ok: true, items: rows.results ?? [] }, 200, headers);
  } catch {
    // 迁移还没应用 / 表还没建 —— 回空列表，前端显示空状态，不报错
    return json({ ok: false, items: [] }, 200, headers);
  }
}
