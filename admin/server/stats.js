// 访问统计（阶段 M · 方案 §11 路线 B）
//
// 数据从哪来：访客 → `/api/hit`（Vercel 函数）→ Upstash Redis 计数 →
//             **GitHub Action 每 6 小时**汇总成 `stats.json` → 写进**私有仓库**。
// 后台只负责**读那份文件**画图 —— 服务器在国内，直连境外 Redis 又慢又不稳，
// 走「Action 汇总 + 读仓库文件」就完全避开了（和友链申请同一套通道与 token）。
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

/** 趋势图给多少天（前端画 30 天，留点余量给「近 7 天/近 30 天」的对比）*/
const TREND_DAYS = 90;
/** 榜单给多少条 */
const TOP_N = 20;

let cache = { at: 0, data: null };

const contentsUrl = () =>
  `${config.applyApiBase.replace(/\/$/, '')}/repos/${config.applyRepo}/contents/${config.statsPath}`;

async function fetchStats() {
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

const sumDays = (days) => days.reduce((acc, d) => ({ pv: acc.pv + d.pv, uv: acc.uv + d.uv }), { pv: 0, uv: 0 });

/** 统计总览（给「访问统计」页用）*/
export async function getStats({ force = false } = {}) {
  if (!config.applyToken) {
    return {
      enabled: false,
      empty: true,
      repo: config.applyRepo,
      path: config.statsPath,
      reason: '还没配读取令牌，读不到私有仓库里的统计文件',
    };
  }

  if (!force && cache.data && Date.now() - cache.at < config.statsCacheMs) return cache.data;

  const raw = await fetchStats();
  if (!raw) {
    const empty = {
      enabled: true,
      empty: true,
      repo: config.applyRepo,
      path: config.statsPath,
      reason: '还没有汇总文件 —— 自动汇总还没跑过第一次，跑完就有了',
      totals: { pv: 0, uv: 0 },
      days: [],
      pages: [],
      referrers: [],
      countries: [],
      devices: [],
    };
    cache = { at: Date.now(), data: empty };
    return empty;
  }

  const days = [...raw.days].sort((a, b) => a.d.localeCompare(b.d));
  const recent = days.slice(-TREND_DAYS);
  const today = days.at(-1) ?? { d: '', pv: 0, uv: 0 };
  const last7 = sumDays(days.slice(-7));
  const last30 = sumDays(days.slice(-30));

  const data = {
    enabled: true,
    empty: false,
    repo: config.applyRepo,
    path: config.statsPath,
    generatedAt: raw.generatedAt,
    /** 数据只到这一天（Action 每 6 小时跑一次，所以最多滞后 6 小时）*/
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
  cache = { at: Date.now(), data };
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
  cache = { at: 0, data: null };
}
