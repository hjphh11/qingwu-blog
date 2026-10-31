// 访问统计（阶段 M · 方案 §11 路线 B）
//
// **两条取数路（优先级从高到低）** —— 见 docs/后台迁移-Cloudflare方案.md 第 1 步：
//   ① `ADMIN_STATS_MOCK_FILE`  本地 mock 文件（自测用，永远是第一优先）
//   ② `ADMIN_STATS_ENDPOINT`   直接 HTTP 读 Cloudflare Worker `/stats`（数据在 D1）← 唯一线上来源
//
// 原来还有第三条「GitHub Contents API 读私有仓库的 stats.json」的旧路，已于 2026-10-31 删除：
// 那份文件由 GitHub Action 每 6 小时汇总，自 10-18 起就再没产出过新数据；而它只要
// `ADMIN_APPLY_TOKEN` 在（友链申请还要用）就会启用，等于「Worker 一挂就静默退回显示
// 半个月前的过期数字」—— 比直接报错更危险。现在读不到就明确报错。
//
// 返回给前端的**形状两种来源完全一致**（前端一行都不用改）：
//   { enabled, empty, reason?, repo, path, generatedAt, latestDay,
//     totals:{pv,uv}, today:{d,pv,uv}, last7:{pv,uv}, last30:{pv,uv},
//     days:[{d,pv,uv}], pages:[{p,pv}], referrers:[{r,pv}],
//     countries:[{c,pv}], devices:[{v,pv}], counts:{days,pages,referrers,countries} }
import { z } from 'zod';
import { config } from './config.js';
import { httpError } from './jsonFile.js';

const DaySchema = z.object({
  d: z.string(),
  pv: z.number().default(0),
  uv: z.number().default(0),
});
const pair = (key) => z.object({ [key]: z.string(), pv: z.number().default(0) });

const StatsSchema = z.object({
  version: z.number().default(1),
  generatedAt: z.string().default(''),
  totals: z.object({ pv: z.number().default(0), uv: z.number().default(0) }).default({}),
  days: z.array(DaySchema).default([]),
  pages: z.array(pair('p')).default([]),
  referrers: z.array(pair('r')).default([]),
  countries: z.array(pair('c')).default([]),
  devices: z.array(pair('v')).default([]),
});

/** Worker `/stats` 的返回：在 StatsSchema 基础上多了已算好的今日/近 7 天/近 30 天 */
const EndpointSchema = StatsSchema.extend({
  version: z.number().default(2),
  today: DaySchema.optional(),
  last7: z.object({ pv: z.number().default(0), uv: z.number().default(0) }).optional(),
  last30: z.object({ pv: z.number().default(0), uv: z.number().default(0) }).optional(),
  repo: z.string().optional(),
  path: z.string().optional(),
});

/** 趋势图给多少天（前端画 30 天，留点余量给「近 7 天/近 30 天」的对比）*/
const TREND_DAYS = 90;
/** 榜单给多少条 */
const TOP_N = 20;

/** 当前用的是哪条路（只用于日志/说明，不影响返回形状）*/
let source = 'endpoint';
let cache = { at: 0, data: null };

/**
 * ② 线上唯一来源：HTTP 读 Cloudflare Worker 的 `/stats`（D1 实时聚合）。
 * Worker 返回的就是**已经算好的**总览（含 today/last7/last30），所以这里不再自己算，
 * 只做「校验 + 裁剪」。
 */
async function fetchStatsFromEndpoint() {
  if (!config.statsEndpoint) return null;
  const headers = { accept: 'application/json', 'user-agent': 'qingwu-admin' };
  // 口令是可选的：Worker 那边没配 ADMIN_STATS_TOKEN 时不需要
  if (config.statsToken) headers.authorization = `Bearer ${config.statsToken}`;

  let res;
  try {
    res = await fetch(config.statsEndpoint, { headers, signal: AbortSignal.timeout(config.statsTimeoutMs) });
  } catch (err) {
    throw httpError(502, `连不上统计接口（${config.statsEndpoint}）：${err.message}`, 'stats_endpoint_unreachable');
  }
  if (res.status === 401 || res.status === 403) {
    throw httpError(502, `统计接口拒绝访问（HTTP ${res.status}）—— 检查 ADMIN_STATS_TOKEN 是否与 Worker 的 ADMIN_STATS_TOKEN 一致`, 'stats_endpoint_auth');
  }
  if (!res.ok) throw httpError(502, `统计接口返回 HTTP ${res.status}`, 'stats_endpoint_failed');

  let parsed;
  try {
    parsed = await res.json();
  } catch {
    throw httpError(502, '统计接口返回的不是 JSON', 'stats_endpoint_bad_json');
  }
  const check = EndpointSchema.safeParse(parsed);
  if (!check.success) {
    const first = check.error.issues[0];
    throw httpError(502, `统计接口格式不对：${first.path.join('.') || '?'} —— ${first.message}`, 'stats_endpoint_bad_shape');
  }
  return check.data;
}

/** ① 最高优先：本地开发读 mock 文件（`ADMIN_STATS_MOCK_FILE`），校验规则与线上完全一致 */
async function readMock() {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.resolve(process.cwd(), config.statsMockFile);
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  const check = StatsSchema.safeParse(parsed);
  if (!check.success) throw httpError(500, `mock 统计文件格式不对：${check.error.issues[0].message}`, 'stats_mock_bad');
  return check.data;
}

const sumDays = (days) => days.reduce((acc, d) => ({ pv: acc.pv + d.pv, uv: acc.uv + d.uv }), { pv: 0, uv: 0 });

/** 空数据的兜底（数据源固定是 D1，别再让前端显示成 GitHub 仓库）*/
function emptyPayload(reason) {
  return {
    enabled: true,
    empty: true,
    repo: 'cloudflare-d1',
    path: 'hits',
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

/** 统计总览（给「访问统计」页用）*/
export async function getStats({ force = false } = {}) {
  const useMock = Boolean(config.statsMockFile);
  const useEndpoint = !useMock && Boolean(config.statsEndpoint);

  // 两个都没配：明确告诉用户为什么看不到数据
  if (!useMock && !useEndpoint) {
    return {
      enabled: false,
      empty: true,
      repo: 'cloudflare-d1',
      path: 'hits',
      reason: '还没配统计数据源 —— 填 ADMIN_STATS_ENDPOINT（Cloudflare Worker 的 /stats 地址）',
    };
  }

  source = useMock ? 'mock' : 'endpoint';
  if (!force && cache.data && Date.now() - cache.at < config.statsCacheMs && cache.source === source) return cache.data;

  const raw = useMock ? await readMock() : await fetchStatsFromEndpoint();
  if (!raw) {
    const empty = emptyPayload('统计接口还没有数据 —— 访客打过点之后就有了');
    cache = { at: Date.now(), data: empty, source };
    return empty;
  }

  const days = [...raw.days].sort((a, b) => a.d.localeCompare(b.d));
  const recent = days.slice(-TREND_DAYS);
  // 接口那份已经算好了今日/近 7 天/近 30 天（它的「天」就是同一套日历），优先用它自己的；
  // mock 文件没这几个字段，就现算 —— 两边数字口径完全一致。
  const today = raw.today ?? days.at(-1) ?? { d: '', pv: 0, uv: 0 };
  const last7 = raw.last7 ?? sumDays(days.slice(-7));
  const last30 = raw.last30 ?? sumDays(days.slice(-30));

  const data = {
    enabled: true,
    empty: false,
    repo: raw.repo || 'cloudflare-d1',
    path: raw.path || 'hits',
    generatedAt: raw.generatedAt,
    /** 数据只到这一天。D1 是实时的，正常情况下就是今天 */
    latestDay: today.d,
    totals: raw.totals,
    today,
    last7,
    last30,
    /** 近 90 天的每日数据（画趋势图）*/
    days: recent,
    pages: raw.pages.slice(0, TOP_N),
    referrers: raw.referrers.slice(0, TOP_N),
    countries: raw.countries.slice(0, TOP_N),
    devices: raw.devices.slice(0, 8),
    counts: {
      days: days.length,
      pages: raw.pages.length,
      referrers: raw.referrers.length,
      countries: raw.countries.length,
    },
  };
  cache = { at: Date.now(), data, source };
  return data;
}

/** 侧栏/概览用的小结（走同一份缓存）*/
export async function statsSummary() {
  try {
    const s = await getStats();
    return {
      enabled: s.enabled,
      empty: s.empty,
      today: s.today?.pv ?? 0,
      total: s.totals?.pv ?? 0,
      generatedAt: s.generatedAt ?? '',
    };
  } catch (err) {
    return { enabled: true, empty: true, error: err.message };
  }
}

/** 仅供测试：清缓存 */
export function clearStatsCache() {
  cache = { at: 0, data: null, source: '' };
}
