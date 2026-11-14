// 清吾 · 友链「最近更新」探测
//
// 目的只有一个：让访客在友链页一眼看出「这家还在不在写」。
//
// 做法：挨个站试几个最常见的 feed 路径，从 XML 里挑出最大的日期当作「最近更新」。
//   /atom.xml  /rss.xml  /index.xml  /feed  /sitemap.xml
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
const PROBE_PATHS = [
  '/atom.xml',
  '/rss.xml',
  // Hugo（PaperMod 等主题）的默认订阅地址就是这个，且**不在 <head> 里声明**
  // alternate 链接（或声明成别的名字），靠嗅探首页发现不了 —— 只能直接试。
  '/index.xml',
  '/feed',
  '/sitemap.xml',
];

/**
 * 单轮最多抓几个站。
 * 白名单本身只有十几个，这个上限是防止「哪天有人把白名单改成从数据库读」时
 * 又变成一次几百个出站请求的放大器。
 */
const MAX_HOSTS = 40;

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
  'iamyukino.cn',
  'detached.online',
  'blog.mibase.top',
];

/**
 * 抓取白名单 —— **唯一可信来源**。
 *
 * 2026-11-14 加固：以前抓取对象是「种子 ∪ `link_clicks` 里出现过的 host」，
 * 而 `POST /link-click` 是无鉴权的，任何人塞一个主机名进来，第二天的 cron
 * 就会按 `https://<那个 host>/...` 去抓（盲/非盲 SSRF），塞几百条还能把出站
 * 请求放大成一个小型压测机。现在抓取只认这份硬编码白名单；
 * `link_clicks` 退化成纯计数表。
 */
export const FRIEND_HOSTS: readonly string[] = SEED_HOSTS;

/** 是否在友链白名单里（去 www、转小写后比较） */
export function isFriendHost(host: string): boolean {
  const h = String(host || '').replace(/^www\./i, '').toLowerCase();
  return SEED_HOSTS.includes(h);
}

/**
 * 私网 / 回环 / 链路本地地址判定。
 * 不用 DNS 解析（Workers 里拿不到解析结果做重绑保护），所以这只是第一道；
 * 真正兜底的是上面那份白名单 —— 白名单外的 host 根本不会被抓。
 */
function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || /^fe80:/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number);
    const [a, b] = [p[0]!, p[1]!];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

/**
 * 出站抓取的唯一入口：https + 公网 + 只跟一跳同站重定向。
 *
 * `redirect: 'manual'` 是关键 —— 以前是 `'follow'`，攻击者只要让自己的站
 * 302 到 `http://127.0.0.1:8787/...`，抓取器就会跟到明文内网去。
 */
async function safeFetch(url: string, timeoutMs = 6000): Promise<Response | null> {
  const ua = 'Mozilla/5.0 (compatible; qingwu-links/1.0; +https://qingwu.ink)';
  const one = async (target: URL): Promise<Response | null> => {
    if (target.protocol !== 'https:' || isPrivateHostname(target.hostname)) return null;
    const res = await fetch(target.toString(), {
      headers: { 'user-agent': ua },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res;
  };

  try {
    const start = new URL(url);
    const first = await one(start);
    if (!first) return null;
    if (first.status < 300 || first.status >= 400) return first;

    const loc = first.headers.get('location');
    if (!loc) return null;
    const next = new URL(loc, start);
    // 不跨站、不降级到 http、不进内网
    if (next.hostname !== start.hostname) return null;
    return await one(next);
  } catch {
    return null;
  }
}

/** 读响应体但**真的**截断在 cap 字节（原来 `(await res.text()).slice()` 是全量读进内存再切） */
async function readTextCapped(res: Response, cap = 200_000): Promise<string> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > cap * 8) return '';
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, cap);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= cap) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch {
    /* 读一半断了也把已读到的用上 */
  }

  const out = new Uint8Array(Math.min(total, cap));
  let off = 0;
  for (const c of chunks) {
    const n = Math.min(c.byteLength, cap - off);
    out.set(c.subarray(0, n), off);
    off += n;
    if (off >= cap) break;
  }
  return new TextDecoder().decode(out);
}

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

/** 每个站从 feed 里留几篇。「友文」是浏览用的，不是归档，5 篇够看个动向 */
const ITEMS_PER_SITE = 5;

/** 解 XML 实体。`&amp;` 必须放最后 —— 否则 `&amp;lt;` 会被解成 `<` 再被当成标签 */
function decodeEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/** 各种日期写法统一成 YYYY-MM-DD：Atom 是 ISO，RSS 是 RFC822 */
function toIsoDate(raw: string): string | null {
  const text = decodeEntities(raw).trim();
  if (!text) return null;
  const literal = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (literal?.[1]) return literal[1];
  const ts = Date.parse(text);
  if (Number.isFinite(ts)) return new Date(ts).toISOString().slice(0, 10);
  return null;
}

export interface FeedItem {
  url: string;
  host: string;
  title: string;
  published: string | null;
}

/**
 * 从 feed 文本里抠出最新的几条文章。
 *
 * 只认 RSS 的 `<item>` 和 Atom 的 `<entry>` 两种块 —— 它们覆盖了绝大多数博客。
 * 不用 XML 解析器：Workers 里塞一个解析器要么体积大、要么对残缺 feed 直接抛错；
 * 正则切块对「格式不标准但结构还在」的 feed 反而更皮实，这也是 pickLatestDate 的口径。
 */
function parseFeedItems(text: string, host: string, limit = ITEMS_PER_SITE): FeedItem[] {
  const blocks = [
    ...text.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...text.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  const out: FeedItem[] = [];
  for (const block of blocks) {
    if (out.length >= limit) break;

    const titleRaw = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const title = decodeEntities(titleRaw).replace(/\s+/g, ' ').trim();
    if (!title) continue;

    // RSS 的 <link> 是文本，Atom 的是 <link href="..."/>
    const textLink = decodeEntities(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? '').trim();
    const attrLink = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? '';
    const url = /^https?:/i.test(textLink) ? textLink : attrLink;
    if (!/^https?:/i.test(url)) continue;

    const dateRaw =
      block.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\//i)?.[1] ?? '';

    out.push({ url, host, title: title.slice(0, 200), published: toIsoDate(dateRaw) });
  }
  return out;
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
  /** 同一趟顺手解析出来的最新几篇，写进 link_posts 给「友文」页用 */
  items: FeedItem[];
}

async function probeHost(host: string): Promise<ProbeResult> {
  for (const path of PROBE_PATHS) {
    try {
      const res = await safeFetch(`https://${host}${path}`);
      if (!res || !res.ok) continue;

      // 真截断：流式读到 200KB 就停（见 readTextCapped）
      const text = await readTextCapped(res);
      const date = pickLatestDate(text);
      // 抓到日期就说明这是一份能读的 feed —— 同一次请求里顺手把条目也解析了，
      // 不额外多发出站请求（免费版每天 50 次出站的上限要省着用）
      if (date) return { host, date, source: path, og: null, items: parseFeedItems(text, host) };
    } catch {
      // 超时 / DNS 挂 / 证书错 —— 换下一个路径，别中断整轮
    }
  }
  return { host, date: null, source: '', og: null, items: [] };
}

/**
 * 单独抓一次首页取 og:image。
 * 和 feed 探测分开做：feed 抓到日期就提前 return 了，不能再顺手拿 og。
 * 每个站多一次出站请求，8 个站 + 4 路径 = 40 次，仍在免费版 50 的上限内。
 */
async function probeOgImage(host: string): Promise<string | null> {
  try {
    const res = await safeFetch(`https://${host}/`);
    if (!res || !res.ok) return null;
    const html = await readTextCapped(res);
    return pickOgImage(html, `https://${host}/`);
  } catch {
    return null;
  }
}

/**
 * 抓取名单 = **只有白名单**。
 *
 * 以前这里会并上 `link_clicks` 里出现过的所有 host —— 而 `/link-click` 无鉴权，
 * 等于「公开的抓取目标列表」。2026-11-14 起点击表只用于计数，不再影响出站。
 * 加新友链时记得同步 `SEED_HOSTS`。
 */
async function collectHosts(_env: Env): Promise<string[]> {
  return SEED_HOSTS.slice(0, MAX_HOSTS);
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

  /* —— 顺手把解析到的文章写进 link_posts（「友文」页的数据源）——
     单独一批、单独 catch：这张表挂了不该影响「最近更新」已经写好的结果。 */
  const postStatements = [];
  for (const r of probes) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value.items) {
      postStatements.push(
        env.DB.prepare(
          `INSERT INTO link_posts (url, host, title, published, fetched_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(url) DO UPDATE SET
             title = excluded.title,
             published = excluded.published,
             fetched_at = excluded.fetched_at`,
        ).bind(item.url, item.host, item.title, item.published, now),
      );
    }
  }
  // 一年前的顺手清掉，表别无限长（feed 里翻出来的老文章没有浏览价值）
  postStatements.push(
    env.DB.prepare('DELETE FROM link_posts WHERE fetched_at < ?').bind(now - 365 * 86_400_000),
  );
  try {
    await env.DB.batch(postStatements);
  } catch (err) {
    console.error('[links-refresh] 文章写入失败:', err instanceof Error ? err.message : err);
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
