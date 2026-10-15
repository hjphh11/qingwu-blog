#!/usr/bin/env node
// 清吾 · 历史统计迁移（旧 stats.json → D1 的 daily_stats 表）
//
// 为什么要这张汇总表、而不是硬造 hits 明细行？
//   旧 stats.json 只有「每日 PV/UV + 各维度累计（页面/来源/地区/设备）」，
//   **没有逐条访问记录**。要灌进 hits 就得自己编 visitor（访客标识）、
//   还得把「累计 / 排名」反推成「哪天来了哪个访客看了哪个页面」——
//   那等于往数据库里写假数据：UV 会假、页面×日期的分布会假，
//   而且以后想区分「真实记录」和「编的」根本分不出来。
//   daily_stats 则是**如实保留旧的汇总口径**：数字可核对、可重跑、可整体删掉重导。
//
// 数字怎么保证和迁移前一致：
//   · 每天 PV/UV 原样落库；
//   · 各维度（页面/来源/地区/设备）只有「全站累计」没有「每日分布」，
//     所以按**当天 PV 占全站 PV 的比例**摊到每一天（最大余数法，保证逐日求和 = 原始累计）。
//     这样 /stats 把每天并集起来，各榜单的 pv 与旧 stats.json **逐条相等**。
//     注：这是「分布还原」，只影响「哪天的页面榜」，不影响任何总量。
//
// 用法：
//   node scripts/import-stats.mjs --in ../stats.json --out migration.sql
//   node scripts/import-stats.mjs --in ../stats.json --stdout      # 打到屏幕上看看
//   node scripts/import-stats.mjs --in stats.json --out m.sql --only-days-json   # 不摊分布（页面榜只看即时数据）
//
// 生成的 SQL 粘到 Cloudflare 控制台 D1 的 Console 里执行，或者：
//   wrangler d1 execute qingwu --remote --file=./migration.sql
//
// 可重跑：脚本开头会 `DELETE FROM daily_stats`（整表覆盖），不会重复计数。
// 回滚：`DELETE FROM daily_stats;` 就回到「只有即时数据」的状态。

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ————————————————————— 命令行参数 —————————————————————
const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);

if (has('--help') || has('-h')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 30).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(0);
}

const IN = arg('--in', 'stats.json');
const OUT = arg('--out', '');
const STDOUT = has('--stdout') || !OUT;
const ONLY_DAYS = has('--only-days-json') || has('--only-days');

// ————————————————————— 读输入 —————————————————————
/** 读旧的 stats.json（形状见 scripts/stats-collect.mjs 的 collectStats） */
function readStats(file) {
  const text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
  const data = JSON.parse(text);
  if (!Array.isArray(data?.days)) throw new Error(`${file} 里没有 days 数组 —— 不像是统计汇总文件`);
  return data;
}

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const int = (v) => Math.max(0, Math.round(num(v)));

/**
 * 最大余数法：把 total 按 weights 的比例拆成整数，**保证拆分后求和恰好等于 total**。
 * 不用它就一定会有「逐日相加 ≠ 原始累计」的零头误差，统计页数字就会飘。
 */
function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((x) => Math.floor(x));
  let rest = total - out.reduce((a, b) => a + b, 0);
  // 余数大的先补，直到分完
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rest > 0; k++, rest--) out[order[k].i]++;
  return out;
}

/** 把「累计榜单」摊到每一天：返回 day → 该天的榜单数组 */
function spreadDaily(list, key, days, dayWeights) {
  const clean = (Array.isArray(list) ? list : [])
    .map((it) => ({ k: String(it?.[key] ?? ''), pv: int(it?.pv) }))
    .filter((it) => it.k && it.pv > 0);
  if (clean.length === 0) return days.map(() => []);

  // 每个键一条独立的「逐日额度」
  const perKey = clean.map((it) => ({ k: it.k, parts: apportion(it.pv, dayWeights) }));
  return days.map((_, dayIdx) =>
    perKey
      .map((it) => ({ [key]: it.k, pv: it.parts[dayIdx] }))
      .filter((it) => it.pv > 0),
  );
}

/** SQL 字符串字面量转义（只用于生成的脚本，不接受外部输入） */
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

function main() {
  const raw = readStats(IN);

  const days = [...new Set((raw.days ?? []).map((d) => String(d?.d ?? '')))]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (days.length === 0) throw new Error('输入文件里没有任何合法的 YYYY-MM-DD 日期');

  const dayPv = new Map((raw.days ?? []).map((d) => [String(d?.d ?? ''), int(d?.pv)]));
  const dayUv = new Map((raw.days ?? []).map((d) => [String(d?.d ?? ''), int(d?.uv)]));
  const weights = days.map((d) => dayPv.get(d) ?? 0);

  const source = `${path.basename(IN)}@${String(raw.generatedAt ?? '').slice(0, 10) || 'unknown'}`;
  const importedAt = Math.floor(Date.now() / 1000);

  const pagesByDay = ONLY_DAYS ? days.map(() => []) : spreadDaily(raw.pages, 'p', days, weights);
  const refsByDay = ONLY_DAYS ? days.map(() => []) : spreadDaily(raw.referrers, 'r', days, weights);
  const ctryByDay = ONLY_DAYS ? days.map(() => []) : spreadDaily(raw.countries, 'c', days, weights);
  const devsByDay = ONLY_DAYS ? days.map(() => []) : spreadDaily(raw.devices, 'v', days, weights);

  const lines = [];
  lines.push('-- 由 worker/scripts/import-stats.mjs 生成 —— 把旧 stats.json 灌进 D1 的 daily_stats 表');
  lines.push(`-- 输入：${IN}`);
  lines.push(`-- 生成时间：${new Date().toISOString()}`);
  lines.push(`-- 覆盖范围：${days.length} 天（${days[0]} ~ ${days.at(-1)}）`);
  lines.push(`-- 旧文件总量：PV ${int(raw?.totals?.pv)} / UV ${int(raw?.totals?.uv)}`);
  if (ONLY_DAYS) lines.push('-- 注意：--only-days-json 模式，只导每日 PV/UV，各维度榜单不还原');
  lines.push('-- 可重跑：整表覆盖。回滚：DELETE FROM daily_stats;');
  lines.push('');
  lines.push('BEGIN TRANSACTION;');
  // 幂等：先清空（daily_stats 只装历史，不装即时数据，所以清掉是安全的）
  lines.push('DELETE FROM daily_stats;');
  lines.push('');

  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const cols = [
      sqlStr(d),
      String(dayPv.get(d) ?? 0),
      String(dayUv.get(d) ?? 0),
      sqlStr(JSON.stringify(pagesByDay[i])),
      sqlStr(JSON.stringify(refsByDay[i])),
      sqlStr(JSON.stringify(ctryByDay[i])),
      sqlStr(JSON.stringify(devsByDay[i])),
      sqlStr(source),
      String(importedAt),
    ];
    lines.push(
      `INSERT INTO daily_stats (day, pv, uv, pages, referrers, countries, devices, source, imported_at) ` +
        `VALUES (${cols.join(', ')});`,
    );
  }

  lines.push('');
  lines.push('COMMIT;');
  lines.push('');

  const sql = lines.join('\n');
  if (OUT) {
    writeFileSync(path.resolve(process.cwd(), OUT), sql, 'utf8');
    console.log(`[import-stats] 已写出 ${OUT}（${days.length} 天）`);
    console.log(`[import-stats] 执行：wrangler d1 execute qingwu --remote --file=./${OUT}`);
  } else {
    console.log(sql);
  }

  // 自检：把生成的每日数据重新求和，和旧文件对比 —— 数字必须相等
  const sumPv = days.reduce((a, d) => a + (dayPv.get(d) ?? 0), 0);
  const sumUv = days.reduce((a, d) => a + (dayUv.get(d) ?? 0), 0);
  /** 把「逐日榜单」摊平后求和。⚠️ 每个元素是 `{ [key]: 名称, pv: 次数 }`，求和的是 pv —— 不是 key。 */
  const pvOf = (byDay) => byDay.flat().flat().reduce((a, it) => a + int(it?.pv), 0);
  console.log(
    `[import-stats] 自检：${days.length} 天，逐日 PV 合计 ${sumPv} / UV 合计 ${sumUv}` +
      `（旧文件 totals：PV ${int(raw?.totals?.pv)} / UV ${int(raw?.totals?.uv)}——` +
      '每日键有 TTL，和总量不一定相等，属正常）',
  );
  if (!ONLY_DAYS) {
    const check = [
      ['pages', pagesByDay, (raw.pages ?? []).reduce((a, it) => a + int(it?.pv), 0)],
      ['referrers', refsByDay, (raw.referrers ?? []).reduce((a, it) => a + int(it?.pv), 0)],
      ['countries', ctryByDay, (raw.countries ?? []).reduce((a, it) => a + int(it?.pv), 0)],
      ['devices', devsByDay, (raw.devices ?? []).reduce((a, it) => a + int(it?.pv), 0)],
    ];
    let allOk = true;
    for (const [name, byDay, oldSum] of check) {
      const newSum = pvOf(byDay);
      if (newSum !== oldSum) allOk = false;
      console.log(
        `[import-stats] ${name}: 还原后合计 ${newSum} / 旧文件合计 ${oldSum} ${newSum === oldSum ? '✓' : '✗ 不一致！'}`,
      );
    }
    console.log(
      allOk
        ? '[import-stats] 各维度榜单累计值全部吻合 ✓（迁移后统计页的榜单数字与迁移前一致）'
        : '[import-stats] ⚠️ 有不一致项 —— 先别执行 SQL，把输入文件发我看看',
    );
  }
}

try {
  main();
} catch (err) {
  console.error('[import-stats] 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
}
