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
const SEED_HOSTS = [
  'rainzt.cn',
  'hty.rest',
  'daily.yybb.us',
  'lygalaxy.cn',
  'blog.cuteleaf.cn',
  'dreamcenter.top',
  'blog.moesam.com',
  'ragnote.top',
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

interface ProbeResult {
  host: string;
  date: string | null;
  source: string;
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
      if (date) return { host, date, source: path };
    } catch {
      // 超时 / DNS 挂 / 证书错 —— 换下一个路径，别中断整轮
    }
  }
  return { host, date: null, source: '' };
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
  const results = await Promise.allSettled(hosts.map((h) => probeHost(h)));
  const now = Date.now();

  const statements = results.map((r, i) => {
    const host = hosts[i]!;
    if (r.status === 'fulfilled' && r.value.date) {
      return env.DB.prepare(
        `INSERT INTO link_feeds (url, last_updated, source, checked_at, ok) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(url) DO UPDATE SET
           last_updated = excluded.last_updated,
           source = excluded.source,
           checked_at = excluded.checked_at,
           ok = 1`,
      ).bind(host, r.value.date, r.value.source, now);
    }
    // 这次没抓到：保留上次的日期（站点临时挂掉不该把「最近更新」抹成空）
    return env.DB.prepare(
      `INSERT INTO link_feeds (url, last_updated, source, checked_at, ok) VALUES (?, NULL, '', ?, 0)
       ON CONFLICT(url) DO UPDATE SET checked_at = excluded.checked_at, ok = 0`,
    ).bind(host, now);
  });

  let updated = 0;
  let failed = 0;
  try {
    await env.DB.batch(statements);
    for (const r of results) {
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
