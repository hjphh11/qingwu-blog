// 清吾 · GET /stats —— 后台「访问统计」页的数据源
//
// **响应形状必须与 `admin/server/stats.js` 的返回值逐字段一致**（后台前端一行都不用改）：
//   { enabled, empty, reason?, repo, path, generatedAt, latestDay,
//     totals:{pv,uv}, today:{d,pv,uv}, last7:{pv,uv}, last30:{pv,uv},
//     days:[{d,pv,uv}]（近 90 天，升序）,
//     pages:[{p,pv}]（前 20）, referrers:[{r,pv}]（前 20）,
//     countries:[{c,pv}]（前 20）, devices:[{v,pv}]（前 8）,
//     counts:{days,pages,referrers,countries} }
//
// 数据从 D1 聚合：
//   · 即时数据在 `hits`（一条 = 一次访问，北京时间为天）
//   · 迁移过来的历史汇总在 `daily_stats`（按天，含各维度分布）
// 两张表**永不重叠**（daily_stats 的日期都早于切换点），所以可以直接相加。

import type { Env } from './types';
import { json, parseOrigins, originAllowed, secretEqual } from './util';

/** 趋势图给多少天（前端画 30 天，留余量给「近 7 天/近 30 天」对比）—— 与旧代码一致 */
const TREND_DAYS = 90;
/** 榜单给多少条 —— 与旧代码一致 */
const TOP_N = 20;
/** 设备榜给多少条 —— 与旧代码一致 */
const DEVICE_TOP_N = 8;

interface Pair {
  pv: number;
  d?: string;
  p?: string;
  r?: string;
  c?: string;
  v?: string;
}

/** 数据库里的日汇总行（hits 聚合 或 daily_stats） */
interface Row {
  d: string;
  pv: number;
  uv: number;
}

/** daily_stats 里那几列 JSON */
interface JsonCol {
  day: string;
  pages: string | null;
  referrers: string | null;
  countries: string | null;
  devices: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** 解析 daily_stats 里的 JSON 列；坏了就当空数组（不因为一行脏数据把整页打挂） */
function parseJsonList(raw: string | null, key: 'p' | 'r' | 'c' | 'v'): Pair[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((it) => ({ [key]: String(it?.[key] ?? ''), pv: num(it?.pv) }) as Pair)
      .filter((it) => it[key] !== '' && it.pv > 0);
  } catch {
    return [];
  }
}

/** 按 key 聚合并降序排（与旧的 `mergeList` 同义：同 key 相加） */
function mergeLists(keyName: 'p' | 'r' | 'c' | 'v', ...lists: Pair[][]): Pair[] {
  const m = new Map<string, number>();
  for (const list of lists) {
    for (const it of list) {
      const k = it[keyName];
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + num(it.pv));
    }
  }
  return [...m.entries()]
    .map(([k, pv]) => ({ [keyName]: k, pv }) as Pair)
    .sort((a, b) => b.pv - a.pv);
}

/**
 * 数据库取数。**任何失败都往外抛**，由路由层统一变成 5xx（不泄露内部信息）。
 */
async function loadStats(env: Env): Promise<{
  totals: { pv: number; uv: number };
  byDay: Map<string, { pv: number; uv: number }>;
  historical: { pages: Pair[]; referrers: Pair[]; countries: Pair[]; devices: Pair[] };
  counts: { days: number };
}> {
  const db = env.DB;

  // ① 总量：hits 明细行数 + 历史汇总之和；UV 是「历史每日 UV 之和 + 即时访客去重」
  const totalsRow = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM hits) AS hit_pv,
         (SELECT COUNT(DISTINCT visitor) FROM hits) AS hit_uv,
         (SELECT COALESCE(SUM(pv), 0) FROM daily_stats) AS old_pv,
         (SELECT COALESCE(SUM(uv), 0) FROM daily_stats) AS old_uv`,
    )
    .first<{ hit_pv: number; hit_uv: number; old_pv: number; old_uv: number }>();

  // ② 每日：hits 按天聚合 + daily_stats 每日行（两边相加；正常不会重叠）
  const dayRows = await db
    .prepare(
      `SELECT day AS d, COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv
         FROM hits GROUP BY day
       UNION ALL
       SELECT day AS d, pv AS pv, uv AS uv FROM daily_stats`,
    )
    .all<Row>();

  const byDay = new Map<string, { pv: number; uv: number }>();
  for (const r of dayRows.results ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.d))) continue; // 脏日期直接丢
    const cur = byDay.get(r.d) ?? { pv: 0, uv: 0 };
    cur.pv += num(r.pv);
    cur.uv += num(r.uv);
    byDay.set(r.d, cur);
  }

  // ③ 历史各维度分布（迁移脚本按当天 PV 占比摊到每一天，所以这里全量并集就是原始累计）
  const jsonRows = await db
    .prepare('SELECT day, pages, referrers, countries, devices FROM daily_stats')
    .all<JsonCol>();
  const historical = { pages: [] as Pair[], referrers: [] as Pair[], countries: [] as Pair[], devices: [] as Pair[] };
  for (const r of jsonRows.results ?? []) {
    historical.pages.push(...parseJsonList(r.pages, 'p'));
    historical.referrers.push(...parseJsonList(r.referrers, 'r'));
    historical.countries.push(...parseJsonList(r.countries, 'c'));
    historical.devices.push(...parseJsonList(r.devices, 'v'));
  }

  return {
    totals: {
      pv: num(totalsRow?.hit_pv) + num(totalsRow?.old_pv),
      uv: num(totalsRow?.hit_uv) + num(totalsRow?.old_uv),
    },
    byDay,
    historical: {
      // 历史里每天都有同一批键，这里再按 key 累加一次（等价于原始累计值）
      pages: mergeLists('p', historical.pages),
      referrers: mergeLists('r', historical.referrers),
      countries: mergeLists('c', historical.countries),
      devices: mergeLists('v', historical.devices),
    },
    counts: { days: byDay.size },
  };
}

const sumDays = (days: { pv: number; uv: number }[]) =>
  days.reduce((acc, d) => ({ pv: acc.pv + d.pv, uv: acc.uv + d.uv }), { pv: 0, uv: 0 });

/** 空数据时的兜底（与旧 `stats.js` 的 empty 分支同形） */
function emptyStats(env: Env, reason: string) {
  return {
    enabled: true,
    empty: true,
    repo: env.STATS_SOURCE_REPO || 'cloudflare-d1',
    path: env.STATS_SOURCE_PATH || 'hits',
    reason,
    totals: { pv: 0, uv: 0 },
    days: [],
    pages: [],
    referrers: [],
    countries: [],
    devices: [],
    counts: { days: 0, pages: 0, referrers: 0, countries: 0 },
  };
}

/**
 * 组装 /stats 响应体。与 `admin/server/stats.js` 的 `getStats()` 输出同构。
 */
export async function buildStats(env: Env) {
  const repo = env.STATS_SOURCE_REPO || 'cloudflare-d1';
  const path = env.STATS_SOURCE_PATH || 'hits';

  const { totals, byDay, historical, counts } = await loadStats(env);
  if (byDay.size === 0 && totals.pv === 0) {
    return emptyStats(env, 'D1 里还没有访问数据 —— 打一次页面就有了（或先跑一次历史迁移脚本）');
  }

  // 日期升序（前端按顺序画趋势图）
  const days = [...byDay.entries()]
    .map(([d, v]) => ({ d, pv: v.pv, uv: v.uv }))
    .sort((a, b) => a.d.localeCompare(b.d));

  const recent = days.slice(-TREND_DAYS);
  const today = days.at(-1) ?? { d: '', pv: 0, uv: 0 };
  const last7 = sumDays(days.slice(-7));
  const last30 = sumDays(days.slice(-30));

  // ④ 各维度榜单：历史（daily_stats） + 即时（hits）后按 pv 降序
  const pageRows = await env.DB.prepare(
    `SELECT path AS k, COUNT(*) AS pv FROM hits GROUP BY path ORDER BY pv DESC, k ASC`,
  ).all<{ k: string; pv: number }>();
  const refRows = await env.DB.prepare(
    `SELECT referrer AS k, COUNT(*) AS pv FROM hits GROUP BY referrer ORDER BY pv DESC, k ASC`,
  ).all<{ k: string; pv: number }>();
  const countryRows = await env.DB.prepare(
    `SELECT country AS k, COUNT(*) AS pv FROM hits GROUP BY country ORDER BY pv DESC, k ASC`,
  ).all<{ k: string; pv: number }>();
  const deviceRows = await env.DB.prepare(
    `SELECT device AS k, COUNT(*) AS pv FROM hits GROUP BY device ORDER BY pv DESC, k ASC`,
  ).all<{ k: string; pv: number }>();

  const rowsToPairs = (rows: { k: string | null; pv: number }[] | undefined, key: 'p' | 'r' | 'c' | 'v'): Pair[] =>
    (rows ?? [])
      .filter((r) => r.k !== null && r.k !== '')
      .map((r) => ({ [key]: String(r.k), pv: num(r.pv) }) as Pair);

  const pages = mergeLists('p', historical.pages, rowsToPairs(pageRows.results, 'p'));
  const referrers = mergeLists('r', historical.referrers, rowsToPairs(refRows.results, 'r'));
  const countries = mergeLists('c', historical.countries, rowsToPairs(countryRows.results, 'c'));
  const devices = mergeLists('v', historical.devices, rowsToPairs(deviceRows.results, 'v'));

  return {
    enabled: true,
    empty: false,
    repo,
    path,
    /** 现在是实时聚合，不再是「每 6 小时汇总一次」的产物 */
    generatedAt: new Date().toISOString(),
    latestDay: today.d,
    totals,
    today,
    last7,
    last30,
    days: recent,
    pages: pages.slice(0, TOP_N),
    referrers: referrers.slice(0, TOP_N),
    countries: countries.slice(0, TOP_N),
    devices: devices.slice(0, DEVICE_TOP_N),
    counts: {
      days: counts.days,
      pages: pages.length,
      referrers: referrers.length,
      countries: countries.length,
    },
  };
}

/** GET /stats —— 需要口令（`ADMIN_STATS_TOKEN`，`Authorization: Bearer xxx`） */
export async function getStats(request: Request, env: Env): Promise<Response> {
  const origins = parseOrigins(env.ALLOWED_ORIGINS);
  const origin = request.headers.get('origin');
  const cors: Record<string, string> = {};
  // 后台是服务端调用（带口令），不会走 CORS；这里只是给将来浏览器直连留个口子
  if (origin && originAllowed(origin, origins)) cors['access-control-allow-origin'] = origin;

  // 配了口令就必须要（后台服务器会带上）；没配则视为「不设口令」并在 README 里明确警告
  if (env.ADMIN_STATS_TOKEN) {
    const auth = request.headers.get('authorization') || '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!token || !(await secretEqual(token, env.ADMIN_STATS_TOKEN))) {
      // 401 不带任何内部信息（不回显 token、不区分「没带」与「带错」）
      return json({ enabled: false, empty: true, reason: '未授权：请带正确的 Authorization: Bearer 口令' }, 401, cors);
    }
  }

  try {
    return json(await buildStats(env), 200, cors);
  } catch (err) {
    // 只记服务端日志；对外是通用 5xx，**不泄露 D1/表结构等内部信息**
    console.error('[stats] 查询 D1 失败:', err instanceof Error ? err.message : err);
    return json(
      { enabled: false, empty: true, reason: '统计服务暂时不可用（数据库查询失败），稍后再试' },
      503,
      cors,
    );
  }
}
