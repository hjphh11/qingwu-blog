/**
 * 互联站点的「名字」。
 *
 * 侧栏那张卡只拿得到域名：`remote_site` 是出站方带过来的 URL（`https://rainzt.cn/`），
 * 而人认的是「朝朝听雨」「冷汐的杂货铺」。所以去对方首页捞一次 `<title>`，缓存 7 天。
 *
 * ## 为什么要在 cron 里慢慢补，而不是请求时现抓
 *
 * `who` 是 30 秒一次的热接口，8 个站各抓一个网页（每个 4 秒超时）会把侧栏拖死。
 * 改成每分钟补一个：第一次看到新站时先显示域名，几分钟后自己变成名字 —— 慢一点，但页面不卡。
 *
 * ## 安全
 *
 * host 来自**别人的消息内容**，等于让人指定我们服务器去访问哪儿（SSRF）。
 * 防线和 `link.ts` 同一套思路，但这里更窄：只允许「像域名的字符串」，
 * 拒绝 IP 字面量、端口、localhost、以及只有一段的名字。
 */

import type { Env } from '../types';

/** 说明自己是谁，也避免被当成爬虫直接 403 */
const UA = 'Mozilla/5.0 (compatible; qingwu-peerbot/1.0; +https://www.qingwu.ink/)';
const TIMEOUT = 4000;
const MAX_BYTES = 64_000;
/** 成功缓存 7 天；失败缓存 24 小时（给对方站一个重试的机会） */
const TTL_OK = 7 * 24 * 3600 * 1000;
const TTL_FAIL = 24 * 3600 * 1000;
/** 只看最近 30 天还在说话的站，和 `listPeers` 的口径一致 */
const PEER_WINDOW = 30 * 24 * 3600 * 1000;

/**
 * 标题里这些是「页面名」不是「站名」：
 * 有的站首页 `<title>` 就是 `Element`（默认的 Element Web），抓来当站名只会更迷惑。
 */
const GENERIC = /^(element|home|homepage|index|untitled|welcome|main)$/i;

/**
 * 站点地址归一化。`matrix.leenet.xyz` 与 `leenet.xyz` 是同一个站。
 * `chat.` 故意不剥：那可能真是另一个站。
 */
export function hostOfSite(site: string): string {
  try {
    return new URL(site).host.toLowerCase().replace(/^www\./, '').replace(/^matrix\./, '');
  } catch {
    return '';
  }
}

/** 这个 host 能不能去抓。宁可漏抓，也不给服务器开一个「访问任意地址」的口子 */
export function isSafeHost(host: string): boolean {
  if (!host || host.length > 100) return false;
  // 只允许 小写字母/数字/连字符/点，且必须带一个点（拒绝 localhost 这种）
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return false;
  if (host.includes('..')) return false;
  // IP 字面量一律拒绝（v4 形如 1.2.3.4 —— 上面的正则也放行，所以单独挡）
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
  return true;
}

/**
 * 从 `<title>` 里挑出站名。
 *
 * 常见写法是「站名 - 一句话」「站名 | 副标题」，取分隔符前那段；
 * 全是分隔符的怪标题就整段截断。抓不到像样名字时返回空串（前端退回域名）。
 */
export function cleanTitle(raw: string): string {
  const t = String(raw || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  const head = t.split(/\s+[-–—|·•]\s+/)[0]!.trim();
  const name = (head || t).slice(0, 24).trim();
  if (!name || GENERIC.test(name)) return '';
  return name;
}

/** 抓一次首页标题。失败返回空串（调用方照样写表，代表「试过了」） */
async function grabName(host: string): Promise<string> {
  if (!isSafeHost(host)) return '';
  try {
    const res = await fetch(`https://${host}/`, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return '';
    const buf = new Uint8Array(await res.arrayBuffer());
    const html = new TextDecoder('utf-8').decode(buf.subarray(0, MAX_BYTES));
    const m = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html);
    return m ? cleanTitle(m[1]!) : '';
  } catch {
    return '';
  }
}

/** 已知的站名（host → name），只返回还没过期的 */
export async function loadPeerNames(env: Env): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = await env.DB.prepare(
      `SELECT host, name FROM chat_peer_sites WHERE name <> '' AND fetched_at > ?`,
    )
      .bind(Date.now() - TTL_OK)
      .all<{ host: string; name: string }>();
    for (const r of rows.results ?? []) map.set(r.host, r.name);
  } catch {
    /* 表还没迁移 / 查询挂了：侧栏退回显示域名，不影响别的 */
  }
  return map;
}

/**
 * cron 每分钟调一次，**一次只补一个站**。
 *
 * 顺序按「最久没抓过的」来，这样新站和老站的过期名字都能轮上；
 * 抓失败的也写表（`name = ''`），24 小时后再试 —— 不然每次 cron 都会重抓同一个坏站。
 */
export async function warmOnePeerName(env: Env): Promise<string> {
  const now = Date.now();
  try {
    const rows = await env.DB.prepare(
      `SELECT remote_site AS site, MAX(ts) AS last
         FROM chat_messages
        WHERE origin = 'remote' AND status <> 'deleted' AND ts > ? AND remote_site <> ''
        GROUP BY remote_site
        ORDER BY last DESC`,
    )
      .bind(now - PEER_WINDOW)
      .all<{ site: string; last: number }>();

    const hosts = new Set<string>();
    for (const r of rows.results ?? []) {
      const h = hostOfSite(r.site);
      if (h && isSafeHost(h)) hosts.add(h);
    }
    if (!hosts.size) return '';

    const known = await env.DB.prepare(`SELECT host, name, fetched_at FROM chat_peer_sites`).all<{
      host: string;
      name: string;
      fetched_at: number;
    }>();
    const recs = new Map((known.results ?? []).map((r) => [r.host, r]));

    /**
     * 挑一个「该抓了」的站：从没抓过、或者过了缓存期。
     * 抓到名字的 7 天过期，没抓到的 24 小时后再试 —— 否则每分钟都去撞同一个坏站。
     */
    let target = '';
    let oldest = Infinity;
    for (const h of hosts) {
      const rec = recs.get(h);
      const at = rec?.fetched_at ?? 0;
      const ttl = !rec ? 0 : rec.name ? TTL_OK : TTL_FAIL;
      if (now - at <= ttl) continue;
      if (at < oldest) {
        oldest = at;
        target = h;
      }
    }
    if (!target) return '';

    const name = await grabName(target);
    await env.DB.prepare(
      `INSERT INTO chat_peer_sites (host, name, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(host) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at`,
    )
      .bind(target, name, now)
      .run();
    return `${target} → ${name || '(没抓到)'}`;
  } catch (err) {
    console.error('[peer] 补站名失败:', err instanceof Error ? err.message : err);
    return '';
  }
}
