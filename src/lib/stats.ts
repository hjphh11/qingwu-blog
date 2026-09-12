// 访问统计 · 采集层（方案 §11 路线 B）
//
// 访客浏览器 → 同域 `/api/hit`（Vercel 函数）→ **Upstash Redis 计数**
//                                          ↓ GitHub Action 定时汇总（跑在境外，无跨境问题）
//                                     私有仓库里的 `stats.json`
//                                          ↓ 后台读它画图（零跨境，和友链申请同一套通道）
//
// 这个文件只负责**把一次访问变成一批 Redis 命令**；
// 汇总（读 Redis → 写 stats.json）在 `scripts/stats-collect.mjs`，两边共用下面的键名规则。
//
// 隐私：只存**匿名化**的东西 —— IP 与 UA 拼起来用 `APPLY_IP_SALT` 做 HMAC 再截断，
// 存的是哈希不是 IP（第 54 条的同一套做法）；独立访客用 HyperLogLog 估基数，不存访客集合。
import { hashIp, pipeline, rateLimitConfig, type UpstashConfig } from './rateLimit';

/** 键名规则（汇总脚本必须保持一致）*/
export const KEY = {
  /** 全站总访问量 */
  totalPv: 'h:total',
  /** 每天的访问量 */
  dayPv: (day: string) => `h:d:${day}`,
  /** 每个页面（路径）的累计访问量 */
  pagePv: (path: string) => `h:p:${path}`,
  /** 来源站点累计 */
  refPv: (host: string) => `h:r:${host}`,
  /** 地区（国家/地区代码）累计 */
  countryPv: (cc: string) => `h:c:${cc}`,
  /** 设备类型累计 */
  devicePv: (device: string) => `h:v:${device}`,
  /** 每天的独立访客（HLL）*/
  dayUv: (day: string) => `u:d:${day}`,
  /** 全站独立访客（HLL）*/
  totalUv: 'u:total',
  /** 去重标记：同一访客同一页在窗口内只算一次 */
  seen: (day: string, visitor: string, page: string) => `h:s:${day}:${visitor}:${page}`,
};

/** 每日键保留多久（超过就靠 TTL 自己清掉；全站/每页的累计不设过期）*/
export const RETAIN_DAYS = 200;
/** 同一访客同一页在这个窗口内只记一次访问（刷新不会把数字刷上去）*/
export const DEDUPE_SECONDS = 1800;

/** 爬虫/监控 UA —— 它们不是访客，不计入 */
const BOT_RE =
  /(bot|crawler|spider|slurp|bingpreview|headlesschrome|phantomjs|python-requests|python-urllib|curl\/|wget|axios|go-http-client|okhttp|java\/|libwww|monitor|uptime|pingdom|lighthouse|gtmetrix|ahrefs|semrush|bytespider|petalbot|yandex|baiduspider|sogou|exabot|facebookexternalhit|whatsapp|telegrambot|discordbot|preview)/i;

export const isBot = (ua: string): boolean => !ua || BOT_RE.test(ua);

export type Device = 'mobile' | 'tablet' | 'desktop';

export function deviceOf(ua: string): Device {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobile|iPhone|iPod|Android|Windows Phone|webOS|BlackBerry/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** 以**北京时间**切天（数据看起来才符合直觉）*/
export function dayKey(nowMs: number): string {
  return new Date(nowMs + 8 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 站内路径规范化。
 * ⚠️ 它会变成 Redis 键的一部分，所以**必须走白名单**：只允许 URL 里常见的安全字符，
 * 超长或不认识的字符一律归到 `/(other)`，别让访客随便往键名里塞东西。
 */
export function normPath(raw: string): string {
  let p = String(raw || '/').split('#')[0].split('?')[0].trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '') || '/';
  if (p.length > 120 || !/^[A-Za-z0-9\-_./%]+$/.test(p)) return '/(other)';
  return p;
}

/** 来源只留主机名（去掉 www 与端口）；空 = 直接访问 */
export function refHost(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '(direct)';
  try {
    const h = new URL(s).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]{1,60}$/.test(h) ? h : '(other)';
  } catch {
    return '(other)';
  }
}

/** 国家/地区代码（Vercel 会给 `x-vercel-ip-country`）*/
export function countryOf(raw: string | null | undefined): string {
  const c = String(raw || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : 'XX';
}

export interface Hit {
  path: string;
  referrer: string;
  ip: string;
  ua: string;
  country?: string | null;
  now?: number;
}

export interface CollectResult {
  counted: boolean;
  reason?: 'seen' | 'disabled' | 'bot';
}

/** 采集一次访问。同一访客同一页在 DEDUPE_SECONDS 内只计一次 PV。 */
export async function collectHit(cfg: UpstashConfig, hit: Hit, salt: string): Promise<CollectResult> {
  const now = hit.now ?? Date.now();
  const day = dayKey(now);
  const path = normPath(hit.path);
  const visitor = hashIp(`${hit.ip}|${hit.ua}`, salt).slice(0, 12);
  const seenKey = KEY.seen(day, visitor, hashIp(path, salt).slice(0, 8));

  // ① 去重标记 + 独立访客（HLL：重复加同一个值不影响基数）
  const first = await pipeline(cfg, [
    ['SET', seenKey, '1', 'NX', 'EX', String(DEDUPE_SECONDS)],
    ['PFADD', KEY.dayUv(day), visitor],
    ['EXPIRE', KEY.dayUv(day), String(RETAIN_DAYS * 86400)],
    ['PFADD', KEY.totalUv, visitor],
  ]);
  if (String(first[0] ?? '') !== 'OK') return { counted: false, reason: 'seen' }; // 刚来过，不重复计

  // ② 正式计数（一次 HTTP 往返全带上）
  await pipeline(cfg, [
    ['INCR', KEY.totalPv],
    ['INCR', KEY.dayPv(day)],
    ['EXPIRE', KEY.dayPv(day), String(RETAIN_DAYS * 86400)],
    ['INCR', KEY.pagePv(path)],
    ['INCR', KEY.refPv(refHost(hit.referrer))],
    ['INCR', KEY.countryPv(countryOf(hit.country))],
    ['INCR', KEY.devicePv(deviceOf(hit.ua))],
  ]);
  return { counted: true };
}

/** Upstash 配置（和限流共用同一个库、同一组环境变量）*/
export function statsConfig(): UpstashConfig | null {
  return rateLimitConfig();
}
