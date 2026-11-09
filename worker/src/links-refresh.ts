// 清吾 · 友链「最近更新」探测
//
// 目的只有一个：让访客在友链页一眼看出「这家还在不在写」。
//
// 做法：挨个站试几个最常见的 feed 路径，从 XML 里挑出最大的日期当作「最近更新」。
//   /atom.xml  /rss.xml  /feed  /sitemap.xml
//
// 为什么不用第三方接口（比如各种「友链检测」服务）：多一个依赖、多一份数据外泄，
// 而且这些服务自己也是这么抓的。
//
// ⚠️ 三条实打实的限制，别指望它准：
//   1. 只认**日期字面量**（`2026-10-28` 这种），不解析时区也不排序语义 —— 够用
//   2. 站点没有 feed 也没有 sitemap 就抓不到（纯静态博客很多属于这类），ok=0
//   3. 有些主题的 sitemap 只列页面不写 lastmod，同样抓不到
import type { Env } from './types';

/** 依次尝试的路径，按命中概率排 —— 顺序别随便改，每多试一个就多一次出站请求 */
const PROBE_PATHS = ['/atom.xml', '/rss.xml', '/feed', '/sitemap.xml'];

/**
 * 初始宿主名单。
 *
 * Worker 读不到仓库里的 `src/data/links.json`，所以这里必须有一份种子。
 * 运行时会和 link_clicks 里出现过的 host 取并集 —— 也就是说：
 *   · 点过的友链，即使这里没列，也会被抓
 *   · 新加友链记得在这里补一行（或者等它被人点一次）
 */
/**
 * 种子：links.json 里所有友链的主机名。
 *
 * ⚠️ **加友链时要同步加到这里** —— 抓取对象 = 种子 + link_clicks 里被点过的站，
 *    漏加的话新站要等第一次被点击之后的第二天才会出现「最近更新」。
 * 注意去掉 `www.`（links.json 里 dreamcenter.top 写的是 www.dreamcenter.top）。
 */
const SEED_HOSTS = [
  'rainzt.cn',
  'hty.rest',
  'daily.yybb.us',
  'lygalaxy.cn',
  'blog.cuteleaf.cn',
  'dreamcenter.top',
  'blog.moesam.com',
  'ragnote.top',
  'seasir.top',
  'homulilly.com',
  'n0v0rland.xyz',
  'muyudada.dpdns.org',
];

/** 从一段 XML 里挑最大的合法日期。只认 YYYY-MM-DD 字面量。 */
function pickLatestDate(text: string): string | null {
  const today = new Date().toISOString().slice(0, 10);
  let latest: string | null = null;

  for (const m of text.matchAll(/(\d{4}-\d{2}-\d{2})/g)) {
    const d = m[1];
    if (!d) continue;
    // 下限挡掉版权年份之类（© 2008-2026 里的 2008），上限挡掉未来的排期文章
    if (d < '2015-01-01' || d > today) continue;
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

/**
 * 从首页 HTML 里取 og:image。
 *
 * 属性顺序不固定（`property` 在前 / `content` 在前 都有），所以两套正则都试。
 * 取到之后按 base 解析成绝对地址 —— 不少主题这里写的是相对路径。
 */
function pickOgImage(html: string, base: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    const raw = m?.[1];
    if (!raw) continue;
    try {
      const abs = new URL(raw, base).href;
      if (/^https?:/i.test(abs)) return abs;
    } catch {
      // 相对路径解析失败就跳过
    }
  }
  return null;
}

interface ProbeResult {
  host: string;
  date: string | null;
  source: string;
  og: string | null;
}

async function probeHost(host: string): Promise<ProbeResult> {
  for (const path of PROBE_PATHS) {
    try {
      const res = await fetch(`https://${host}${path}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; qingwu-links/1.0; +https://qingwu.ink)' },
        signal: AbortSignal.timeout(6000),
        redirect: 'follow',
      });
      if (!res.ok) continue;

      // 只读前 200KB：有的 sitemap 能到几 MB，读全了纯浪费
      const text = (await res.text()).slice(0, 200_000);
      const date = pickLatestDate(text);
      if (date) return { host, date, source: path, og: null };
    } catch {
      // 超时 / DNS 挂 / 证书错 —— 换下一个路径，别中断整轮
    }
  }
  return { host, date: null, source: '', og: null };
}

/**
 * 单独抓一次首页取 og:image。
 * 和 feed 探测分开做：feed 抓到日期就提前 return 了，不能再顺手拿 og。
 * 每个站多一次出站请求，8 个站 + 4 路径 = 40 次，仍在免费版 50 的上限内。
 */
async function probeOgImage(host: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${host}/`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; qingwu-links/1.0; +https://qingwu.ink)' },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000);
    return pickOgImage(html, `https://${host}/`);
  } catch {
    return null;
  }
}

/** 取「种子 + 点过」的并集，去掉 www. */
async function collectHosts(env: Env): Promise<string[]> {
  const set = new Set(SEED_HOSTS);
  try {
    const rows = await env.DB.prepare(`SELECT DISTINCT url FROM link_clicks`).all<{ url: string }>();
    for (const r of rows.results ?? []) {
      if (r.url) set.add(r.url.replace(/^www\./i, '').toLowerCase());
    }
  } catch {
    // 表还没建 / 查询失败都不影响种子那批
  }
  return [...set];
}

export interface RefreshSummary {
  total: number;
  updated: number;
  failed: number;
}

/** 跑一轮全量探测并写库。站与站之间并发，单站内部串行试路径。 */
export async function refreshAllFeeds(env: Env): Promise<RefreshSummary> {
  const hosts = await collectHosts(env);

  // 两件事并发：探测 feed 日期、抓首页 og:image
  const [probes, ogs] = await Promise.all([
    Promise.allSettled(hosts.map((h) => probeHost(h))),
    Promise.allSettled(hosts.map((h) => probeOgImage(h))),
  ]);
  const now = Date.now();

  const statements = probes.map((r, i) => {
    const host = hosts[i]!;
    const ogRes = ogs[i];
    const og = ogRes && ogRes.status === 'fulfilled' ? ogRes.value : null;

    if (r.status === 'fulfilled' && r.value.date) {
      return env.DB.prepare(
        `INSERT INTO link_feeds (url, last_updated, source, checked_at, ok, og_image) VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(url) DO UPDATE SET
           last_updated = excluded.last_updated,
           source = excluded.source,
           checked_at = excluded.checked_at,
           ok = 1,
           og_image = COALESCE(excluded.og_image, link_feeds.og_image)`,
      ).bind(host, r.value.date, r.value.source, now, og);
    }
    // 这次没抓到日期：保留上次的日期（站点临时挂掉不该把「最近更新」抹成空）
    return env.DB.prepare(
      `INSERT INTO link_feeds (url, last_updated, source, checked_at, ok, og_image) VALUES (?, NULL, '', ?, 0, ?)
       ON CONFLICT(url) DO UPDATE SET
         checked_at = excluded.checked_at,
         ok = 0,
         og_image = COALESCE(excluded.og_image, link_feeds.og_image)`,
    ).bind(host, now, og);
  });

  let updated = 0;
  let failed = 0;
  try {
    await env.DB.batch(statements);
    for (const r of probes) {
      if (r.status === 'fulfilled' && r.value.date) updated++;
      else failed++;
    }
  } catch {
    return { total: hosts.length, updated: 0, failed: hosts.length };
  }

  return { total: hosts.length, updated, failed };
}

/**
 * 机会式刷新：让首次部署不必等到第二天 cron。
 *
 * 判据是「上一轮完成超过 12 小时」。用一张表里的 max(checked_at) 当水位，
 * 不做并发锁 —— 最坏情况是两个请求同时各跑一次全量（重复抓一遍而已，
 * 写的是同一批 UPSERT，不会写脏）。
 */
export async function maybeRefreshFeeds(env: Env): Promise<void> {
  const STALE_MS = 12 * 60 * 60 * 1000;
  try {
    const row = await env.DB.prepare(`SELECT MAX(checked_at) AS last FROM link_feeds`).first<{
      last: number | null;
    }>();
    const last = row?.last ?? 0;
    if (Date.now() - last < STALE_MS) return;
  } catch {
    return; // 表不存在就别硬跑
  }
  await refreshAllFeeds(env);
}
