// 访问统计（阶段 M · 方案 §11 路线 B）
//
// **三条取数路（优先级从高到低）** —— 见 docs/后台迁移-Cloudflare方案.md 第 1 步：
//   ① `ADMIN_STATS_MOCK_FILE`  本地 mock 文件（自测用，永远是第一优先）
//   ② `ADMIN_STATS_ENDPOINT`   直接 HTTP 读 Cloudflare Worker `/stats`（数据在 D1）← 迁移后的新路
//   ③ GitHub Contents API      读私有仓库里那份由 Action 每 6 小时汇总的 stats.json（旧路，保留回退）
//
// 返回给前端的**形状三种来源完全一致**（前端一行都不用改）：
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
let source = 'github';
let cache = { at: 0, data: null };

const contentsUrl = () =>
  `${config.applyApiBase.replace(/\/$/, '')}/repos/${config.applyRepo}/contents/${config.statsPath}`;

/** ③ 旧路：GitHub Contents API 读 stats.json（Action 每 6 小时写一份）*/
async function fetchStatsFromGithub() {
  const res = await fetch(`${contentsUrl()}?ref=${encodeURIComponent(config.applyRef)}`, {
    headers: {
      authorization: `Bearer ${config.applyToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'qingwu-admin',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20_000),
  });

  // 还没跑过 Action（或换了文件名）时，文件本来就可能不存在 —— 这不是错误
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw httpError(502, `读统计文件时 token 权限不够（GitHub ${res.status}）`, 'stats_auth');
  }
  if (!res.ok) throw httpError(502, `读统计文件失败：GitHub ${res.status}`, 'stats_read');

  const data = await res.json();
  const text = Buffer.from(String(data.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw httpError(502, `${config.statsPath} 不是合法 JSON`, 'stats_bad_json');
  }
  const check = StatsSchema.safeParse(parsed);
  if (!check.success) {
    const first = check.error.issues[0];
    throw httpError(502, `统计文件格式不对：${first.path.join('.') || '?'} —— ${first.message}`, 'stats_bad_shape');
  }
  return check.data;
}

/**
 * ② 新路：HTTP 读 Cloudflare Worker 的 `/stats`（D1 实时聚合）。
 * Worker 返回的就是**已经算好的**总览（含 today/last7/last30），所以这里不再自己算，
 * 只做「校验 + 裁剪」—— 保证和旧路输出完全同形。
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

/** 空数据的兜底（repo/path 跟着当前数据源走，别让前端显示成 GitHub 仓库）*/
function emptyPayload(reason) {
  const fromEndpoint = source === 'endpoint';
  return {
    enabled: true,
    empty: true,
    repo: fromEndpoint ? 'cloudflare-d1' : config.applyRepo,
    path: fromEndpoint ? 'hits' : config.statsPath,
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
  const useGithub = !useMock && !useEndpoint && Boolean(config.applyToken);

  // 三个都没配：保持原样，明确告诉用户为什么看不到数据
  if (!useMock && !useEndpoint && !config.applyToken) {
    return {
      enabled: false,
      empty: true,
      repo: config.applyRepo,
      path: config.statsPath,
      reason: '还没配统计数据源 —— 填 ADMIN_STATS_ENDPOINT（Cloudflare Worker），或保留旧的 ADMIN_APPLY_TOKEN 读私有仓库',
    };
  }

  source = useMock ? 'mock' : useEndpoint ? 'endpoint' : 'github';
  if (!force && cache.data && Date.now() - cache.at < config.statsCacheMs && cache.source === source) return cache.data;

  const raw = useMock ? await readMock() : useEndpoint ? await fetchStatsFromEndpoint() : useGithub ? await fetchStatsFromGithub() : null;
  if (!raw) {
    const empty = emptyPayload(
      useEndpoint
        ? '统计接口还没有数据 —— 访客打过点之后就有了'
        : '还没有汇总文件 —— 自动汇总还没跑过第一次，跑完就有了',
    );
    cache = { at: Date.now(), data: empty, source };
    return empty;
  }

  const days = [...raw.days].sort((a, b) => a.d.localeCompare(b.d));
  const recent = days.slice(-TREND_DAYS);
  // 接口那份已经算好了今日/近 7 天/近 30 天（它的「天」就是同一套日历），优先用它自己的；
  // 旧路（GitHub 文件）没这几个字段，就按原来的方式现算 —— 两条路的数字口径完全一致。
  const today = raw.today ?? days.at(-1) ?? { d: '', pv: 0, uv: 0 };
  const last7 = raw.last7 ?? sumDays(days.slice(-7));
  const last30 = raw.last30 ?? sumDays(days.slice(-30));

  const data = {
    enabled: true,
    empty: false,
    repo: raw.repo || (useEndpoint ? 'cloudflare-d1' : config.applyRepo),
    path: raw.path || (useEndpoint ? 'hits' : config.statsPath),
    generatedAt: raw.generatedAt,
    /** 数据只到这一天。旧路每 6 小时汇总一次，最多滞后 6 小时；新路（D1）是实时的 */
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
