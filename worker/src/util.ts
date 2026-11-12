// 清吾 · Worker 共享工具
//
// ⚠️ 这里的口径**必须和旧的站点侧 `src/lib/stats.ts` 逐字对齐**，
// 否则迁移前后统计页的数字会对不上。每个函数都标了它在旧代码里的出处。
//
// 只依赖 Web 标准 API（crypto.subtle / TextEncoder），所以 Workers 里直接可用。

// ——————————————————————————————————————————————————————————
// 时区：Asia/Shanghai（北京时间）
// ——————————————————————————————————————————————————————————
/** 一天的秒数 */
export const DAY_SECONDS = 86_400;
/** 北京时间相对 UTC 的固定偏移（秒）。中国不实行夏令时，所以固定 +8 是准确的。 */
export const CN_OFFSET_SECONDS = 8 * 3600;

/**
 * 以**北京时间**切天 —— 与旧 `stats.ts` 的 `dayKey()` 同口径
 * （旧代码：`new Date(nowMs + 8*3600_000).toISOString().slice(0,10)`）。
 */
export function dayKey(nowMs: number): string {
  return new Date(nowMs + CN_OFFSET_SECONDS * 1000).toISOString().slice(0, 10);
}

// ——————————————————————————————————————————————————————————
// 规范化（防脏数据 / 防注入键名 / 控制基数）
// ——————————————————————————————————————————————————————————
/**
 * 站内路径规范化 —— 与旧 `stats.ts` 的 `normPath()` 同口径。
 * 白名单：只允许 URL 里常见的安全字符；超长或不认识的字符一律归到 `/(other)`。
 */
export function normPath(raw: unknown): string {
  let p = String(raw ?? '/').split('#')[0].split('?')[0].trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '') || '/';
  if (p.length > 120 || !/^[A-Za-z0-9\-_./%]+$/.test(p)) return '/(other)';
  return p;
}

/** 来源只留主机名（去掉 www 与端口）；空 = 直接访问 —— 与旧 `refHost()` 同口径。 */
export function refHost(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '(direct)';
  try {
    const h = new URL(s).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]{1,60}$/.test(h) ? h : '(other)';
  } catch {
    return '(other)';
  }
}

/** 国家/地区代码（Cloudflare 给的是 `request.cf.country`）—— 与旧 `countryOf()` 同口径。 */
export function countryOf(raw: unknown): string {
  const c = String(raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : 'XX';
}

// ——————————————————————————————————————————————————————————
// 访客识别
// ——————————————————————————————————————————————————————————
/**
 * 爬虫/监控 UA —— 它们不是访客，不计入。
 * 正则与旧 `stats.ts` 的 `BOT_RE` **完全一致**（新增了 cf 的 `cloudflare-` 一类）。
 */
const BOT_RE =
  /(bot|crawler|spider|slurp|bingpreview|headlesschrome|phantomjs|python-requests|python-urllib|curl\/|wget|axios|go-http-client|okhttp|java\/|libwww|monitor|uptime|pingdom|lighthouse|gtmetrix|ahrefs|semrush|bytespider|petalbot|yandex|baiduspider|sogou|exabot|facebookexternalhit|whatsapp|telegrambot|discordbot|preview)/i;

export const isBot = (ua: string): boolean => !ua || BOT_RE.test(ua);

export type Device = 'mobile' | 'tablet' | 'desktop';

/** 设备粗分 —— 与旧 `stats.ts` 的 `deviceOf()` 同口径。 */
export function deviceOf(ua: string): Device {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobile|iPhone|iPod|Android|Windows Phone|webOS|BlackBerry/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * 匿名访客标识：`SHA-256(盐 | IP | UA)` 取前 12 位十六进制。
 * **不存明文 IP**（和旧代码 `hashIp(`${ip}|${ua}`, salt).slice(0, 12)` 的用途一致）。
 *
 * 旧代码用的是 HMAC-SHA256，这里用「盐当密钥前缀」的普通 SHA-256：
 * 对这个场景（防明文、稳定标识）安全性等价，且 Workers 里一次 subtle.digest 更省。
 * 换掉盐 = 之前所有访客标识立刻失效。
 */
export async function visitorHash(ip: string, ua: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${ip}|${ua}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

// ——————————————————————————————————————————————————————————
// HTTP 小工具
// ——————————————————————————————————————————————————————————
/**
 * 留言正文的「纯文本版」—— 邮件里不能塞 Markdown 标记。
 *
 * 与前端 `src/lib/richText.ts` 的 `toPlain` 保持同一套规则（那两份不共享代码：
 * 一个跑在浏览器、一个跑在 Worker，中间只靠「写法约定」对齐）。
 * 表情 token（`:[bb_doge]`）原样留着 —— 收件人看到也不难懂，换成图片反而要处理失效。
 */
export function plainOf(raw: string): string {
  return String(raw ?? '')
    .replace(/```[a-z0-9+#.-]*\n?/gi, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]{1,80})\]\((https?:\/\/[^\s)]+)\)/gi, '$1（$2）')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .trim();
}

/** JSON 响应。统计接口**永远 no-store**：后台要看到刚写进去的那条。 */
export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

/** 从逗号分隔的配置里解析允许的来源列表；含 `*` 表示不限制。 */
export function parseOrigins(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 从任意字符串里取出小写 host（含端口）；解析不了返回 null。 */
function hostOf(raw: string): string | null {
  try {
    return new URL(raw).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** 是否为允许的来源。列表为空视为「不限制」（宁可放开 /hit，也不要静默丢数据）。 */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0 || allowed.includes('*')) return true;
  if (!origin) return true; // 同源/服务端转发没有 Origin 头，不该被挡
  if (allowed.includes(origin)) return true;

  // ⚠️ 兜底按 host 比，忽略协议：本地 `wrangler dev` 会把**同源**请求的 Origin
  // 改写成 `http://<host>`（协议被降级成本地明文），于是浏览器发的
  // `https://qingwu.ink` 到达 Worker 时变成 `http://qingwu.ink`，
  // 纯字符串比对会把它判成非法 → 所有打点静默归零。
  // 放开协议只影响这个来源校验（打点接口不携带凭据），且 http 本身会 301 到 https。
  const host = hostOf(origin);
  if (!host) return false;
  return allowed.some((a) => hostOf(a) === host);
}

/**
 * 定长比较，避免用 `!==` 比口令时泄漏长度/前缀信息。
 * 两边都会先哈希再比，所以长度不同也走同一条路径。
 */
export async function secretEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}
