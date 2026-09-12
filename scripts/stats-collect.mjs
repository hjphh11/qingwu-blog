#!/usr/bin/env node
// 访问统计 · 汇总（方案 §11 路线 B）
//
// 干的事：读 Upstash 里的计数 → 合成一份 `stats.json` → 写进**私有仓库**（后台读它画图）。
//
// 为什么用 GitHub Action 而不是让后台直接查 Upstash：
//   后台在国内服务器上，直连境外 Redis「又慢又不稳」；Action 跑在境外，没有这个问题，
//   而且顺带把数据落成一份可版本管理的文件（后台读取零跨境，和友链申请同一套通道）。
//
// 环境变量：
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  采集用的那个库（和限流共用）
//   STATS_REPO / STATS_PATH / STATS_REF                存哪（默认 hjphh11/qingwu-link-applications / stats.json / main）
//   STATS_TOKEN                                        能写该私有仓库的 PAT（Contents: Read and write）
//   UPSTASH_API_BASE / GITHUB_API_BASE / STATS_DRY_RUN 本地联调与自测用（平时不用）
//
// 键名规则必须和 `src/lib/stats.ts` 保持一致：
//   h:total 全站 PV | h:d:<day> 每日 PV | h:p:<path> 每页 PV | h:r:<host> 来源
//   h:c:<CC> 地区 | h:v:<device> 设备 | u:d:<day> 每日 UV(HLL) | u:total 全站 UV(HLL)
import { execFileSync } from 'node:child_process';

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const UPSTASH_BASE = (process.env.UPSTASH_API_BASE || '').replace(/\/$/, '');
const GITHUB_BASE = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, '');
const REPO = process.env.STATS_REPO || 'hjphh11/qingwu-link-applications';
const PATH = process.env.STATS_PATH || 'stats.json';
const REF = process.env.STATS_REF || 'main';
const TOKEN = process.env.STATS_TOKEN || '';
const DRY_RUN = process.env.STATS_DRY_RUN === '1';

/** 趋势最多留多少天（超出就丢掉最老的） */
const KEEP_DAYS = 365;

const log = (...a) => console.log('[stats]', ...a);

// ——— Upstash：和前端一样走 /pipeline，一次往返一批命令 ———
async function redis(commands) {
  const base = UPSTASH_BASE || UPSTASH_URL;
  if (!base) throw new Error('没配 UPSTASH_REDIS_REST_URL');
  const res = await fetch(`${base}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${UPSTASH_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Upstash 返回格式异常');
  return data.map((d) => {
    if (d && typeof d === 'object' && 'error' in d && d.error) throw new Error(`Upstash: ${d.error}`);
    return d?.result ?? null;
  });
}

/** 用 SCAN 把某个前缀的键全捞出来（个人站量很小，几百个键就是几次往返） */
async function scanKeys(pattern) {
  const keys = [];
  let cursor = '0';
  for (let i = 0; i < 200; i++) {
    // ⚠️ redis() 返回的是「每条命令一个结果」的数组，所以这里要拆两层
    const [[next, batch]] = await redis([['SCAN', cursor, 'MATCH', pattern, 'COUNT', '500']]);
    if (Array.isArray(batch)) keys.push(...batch.map(String));
    cursor = String(next ?? '0');
    if (cursor === '0' || !Array.isArray(batch)) break;
  }
  return keys;
}

/** 批量取整数（MGET 一次拿一批）*/
async function getNumbers(keys) {
  const out = new Map();
  const CHUNK = 200;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const vals = await redis([['MGET', ...slice]]);
    const list = Array.isArray(vals[0]) ? vals[0] : [];
    slice.forEach((k, idx) => out.set(k, Number(list[idx] ?? 0) || 0));
  }
  return out;
}

const num = (v) => Number(v ?? 0) || 0;
const byValueDesc = (a, b) => b.pv - a.pv;

/** 读 Redis → 组装统计对象 */
export async function collectStats() {
  const [totalPv, totalUv] = await redis([
    ['GET', 'h:total'],
    ['PFCOUNT', 'u:total'],
  ]);

  // ——— 每日：PV 与 UV 分开取，按日期对齐 ———
  const dayPvKeys = await scanKeys('h:d:*');
  const dayUvKeys = await scanKeys('u:d:*');
  const dayPv = await getNumbers(dayPvKeys);
  const dayUvValues = dayUvKeys.length ? await redis(dayUvKeys.map((k) => ['PFCOUNT', k])) : [];
  const uvByDay = new Map(dayUvKeys.map((k, i) => [k.slice('u:d:'.length), num(dayUvValues[i])]));

  const daySet = new Set([
    ...dayPvKeys.map((k) => k.slice('h:d:'.length)),
    ...dayUvKeys.map((k) => k.slice('u:d:'.length)),
  ]);
  const days = [...daySet]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .map((d) => ({ d, pv: num(dayPv.get(`h:d:${d}`)), uv: num(uvByDay.get(d)) }));

  // ——— 每页 / 来源 / 地区 / 设备 ———
  const asList = async (pattern, prefix, key) => {
    const keys = await scanKeys(pattern);
    if (keys.length === 0) return [];
    const vals = await getNumbers(keys);
    return keys
      .map((kk) => ({ [key]: kk.slice(prefix.length), pv: num(vals.get(kk)) }))
      .filter((r) => r[key] && r.pv > 0)
      .sort(byValueDesc);
  };

  const pages = await asList('h:p:*', 'h:p:', 'p');
  const referrers = await asList('h:r:*', 'h:r:', 'r');
  const countries = await asList('h:c:*', 'h:c:', 'c');
  const devices = await asList('h:v:*', 'h:v:', 'v');

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    totals: { pv: num(totalPv), uv: num(totalUv) },
    days,
    pages,
    referrers,
    countries,
    devices,
  };
}

/** 和已有文件合并：Redis 里的每日键会过期，历史靠文件留着 */
export function mergeStats(fresh, old) {
  if (!old || !Array.isArray(old.days)) return fresh;
  const byDay = new Map();
  for (const d of old.days) if (d?.d) byDay.set(d.d, { d: d.d, pv: num(d.pv), uv: num(d.uv) });
  for (const d of fresh.days) byDay.set(d.d, d); // 新数据覆盖同一天
  const days = [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-KEEP_DAYS);

  // 累计类的（每页/来源/…）取两边最大值：Redis 里丢了键也不至于把历史抹掉
  const mergeList = (keyName, a = [], b = []) => {
    const m = new Map();
    for (const it of [...b, ...a]) {
      const k = it?.[keyName];
      if (!k) continue;
      m.set(k, Math.max(num(m.get(k)), num(it.pv)));
    }
    return [...m.entries()].map(([k, pv]) => ({ [keyName]: k, pv })).sort(byValueDesc);
  };

  return {
    ...fresh,
    totals: {
      pv: Math.max(num(fresh.totals?.pv), num(old.totals?.pv)),
      uv: Math.max(num(fresh.totals?.uv), num(old.totals?.uv)),
    },
    days,
    pages: mergeList('p', fresh.pages, old.pages),
    referrers: mergeList('r', fresh.referrers, old.referrers),
    countries: mergeList('c', fresh.countries, old.countries),
    devices: mergeList('v', fresh.devices, old.devices),
  };
}

// ——— 私有仓库读写（Contents API；和后台读它用的是同一份文件）———
const ghHeaders = () => ({
  authorization: `Bearer ${TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'qingwu-stats-action',
  'x-github-api-version': '2022-11-28',
});

export async function readExisting() {
  if (!TOKEN) return null;
  const res = await fetch(`${GITHUB_BASE}/repos/${REPO}/contents/${PATH}?ref=${encodeURIComponent(REF)}`, {
    headers: ghHeaders(),
  });
  if (res.status === 404) return null; // 第一次跑，文件还不存在
  if (!res.ok) throw new Error(`读 ${REPO}/${PATH} 失败：GitHub ${res.status}`);
  const data = await res.json();
  const text = Buffer.from(String(data.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return null; // 文件坏了就当没有（后面会整份覆盖）
  }
}

export async function writeStats(stats, sha) {
  if (!TOKEN) throw new Error('没配 STATS_TOKEN，写不进私有仓库');
  const body = `${JSON.stringify(stats, null, 2)}\n`;
  const res = await fetch(`${GITHUB_BASE}/repos/${REPO}/contents/${PATH}`, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `统计汇总：${stats.generatedAt.slice(0, 10)}（PV ${stats.totals.pv} / UV ${stats.totals.uv}）`,
      content: Buffer.from(body, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`写 ${REPO}/${PATH} 失败：GitHub ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  log(`读 Upstash：${UPSTASH_BASE || UPSTASH_URL || '(未配置)'}`);
  const fresh = await collectStats();
  log(
    `采集到：总 PV ${fresh.totals.pv} / UV ${fresh.totals.uv}；` +
      `每日 ${fresh.days.length} 天；页面 ${fresh.pages.length} 个；来源 ${fresh.referrers.length} 个；` +
      `地区 ${fresh.countries.length} 个；设备 ${fresh.devices.length} 种`,
  );

  // 读现有文件（拿 sha 顺便合并历史）
  let sha = null;
  let old = null;
  if (TOKEN) {
    const res = await fetch(`${GITHUB_BASE}/repos/${REPO}/contents/${PATH}?ref=${encodeURIComponent(REF)}`, {
      headers: ghHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      sha = data.sha ?? null;
      const text = Buffer.from(String(data.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
      try {
        old = JSON.parse(text);
      } catch {
        old = null;
      }
    } else if (res.status !== 404) {
      throw new Error(`读 ${REPO}/${PATH} 失败：GitHub ${res.status}`);
    }
  } else {
    log('没配 STATS_TOKEN，只打印结果不写仓库');
  }

  const stats = mergeStats(fresh, old);
  if (DRY_RUN || !TOKEN) {
    log('DRY RUN —— 将要写入的内容：');
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  await writeStats(stats, sha);
  log(`已写入 ${REPO}/${PATH}（${stats.days.length} 天历史，总 PV ${stats.totals.pv}）`);
}

// 直接 `node scripts/stats-collect.mjs` 才跑 main；被 import 时只导出函数（方便自测）
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('stats-collect.mjs');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[stats] 汇总失败:', err.message);
    process.exit(1);
  });
}
