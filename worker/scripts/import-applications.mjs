#!/usr/bin/env node
// 清吾 · 第 2 步历史数据迁移：私有仓库 applications.json → D1 的 applications 表
//
// 为什么不「直接改 0001_init.sql 重建」：那样远端已执行过的迁移不会重跑，
// 且历史申请（含访客邮箱）会丢。这里单独写一个可重跑、可回滚的导入步骤。
//
// 设计要点：
//   · **保留旧 id 的可追溯性**：旧 id 形如 `app-mvw5c5ce-a4llo`，D1 是自增 INTEGER。
//     导入后 API 返回的是 `d1-<n>`，同时把旧 id 记在 `legacy_id` 里，
//     这样「后台操作日志里写的 app-xxx」还能和 D1 里那条对上。
//   · **可重跑**：按 `legacy_id` 判重，已导入的跳过（不会插两份）。
//   · **status 原样保留**：rejected 的仍然是 rejected（否则对方会被判重复提交）。
//   · **时间原样保留**：created_at = submittedAt 的毫秒数。
//
// 用法（在 worker/ 目录下）：
//   node scripts/import-applications.mjs --in path/to/applications.json --out migration.sql
//   node scripts/import-applications.mjs --in applications.json --stdout     # 先看看
//   然后：wrangler d1 execute qingwu --remote --file=./migration.sql
//
// 回滚：DELETE FROM applications WHERE legacy_id IS NOT NULL;

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);

const IN = arg('--in', 'applications.json');
const OUT = arg('--out', '');
const STDOUT = has('--stdout') || !OUT;

/** SQL 字符串转义：单引号翻倍 */
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (Number.isFinite(Number(v)) ? String(Number(v)) : 'NULL');

function main() {
  const raw = readFileSync(path.resolve(process.cwd(), IN), 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`✗ ${IN} 不是合法 JSON：${e.message}`);
    process.exit(1);
  }

  const apps = Array.isArray(data?.applications) ? data.applications : null;
  if (!apps) {
    console.error(`✗ ${IN} 里没有 applications 数组 —— 不像是申请文件`);
    process.exit(1);
  }

  const lines = [];
  lines.push('-- 清吾 · 友链申请历史数据导入（旧 applications.json → D1）');
  lines.push('-- 由 worker/scripts/import-applications.mjs 生成，可重跑（按 legacy_id 判重）');
  lines.push(`-- 源文件：${IN}，共 ${apps.length} 条`);
  lines.push('');
  lines.push('-- legacy_id 列用于对旧 id 的追溯，先确认它存在（0002 迁移会加）');
  lines.push('');

  const skipped = [];
  for (const a of apps) {
    const legacyId = String(a?.id ?? '').trim();
    const url = String(a?.url ?? '').trim();
    const name = String(a?.name ?? '').trim();
    if (!legacyId || !url || !name) {
      skipped.push(a?.id ?? '(无 id)');
      continue;
    }

    const status = ['pending', 'approved', 'rejected'].includes(a.status) ? a.status : 'pending';
    const created = a.submittedAt ? Date.parse(a.submittedAt) : NaN;
    const handled = a.reviewedAt ? Date.parse(a.reviewedAt) : NaN;

    // 幂等：已有同 legacy_id 或同 url 的就跳过
    lines.push(
      `INSERT INTO applications (name, url, avatar, intro, email, status, reason, created_at, handled_at, legacy_id)`,
    );
    lines.push(
      `SELECT ${q(name)}, ${q(url)}, ${q(a.avatar ?? '')}, ${q(a.intro ?? '')}, ${q(a.email ?? '')}, ` +
        `${q(status)}, ${q(a.reason ?? null)}, ${n(Number.isFinite(created) ? created : Date.now())}, ` +
        `${Number.isFinite(handled) ? n(handled) : 'NULL'}, ${q(legacyId)}`,
    );
    lines.push(
      `WHERE NOT EXISTS (SELECT 1 FROM applications WHERE legacy_id = ${q(legacyId)} OR LOWER(url) = LOWER(${q(url)}));`,
    );
    lines.push('');
  }

  const sql = lines.join('\n');

  if (skipped.length) {
    console.warn(`⚠️  跳过 ${skipped.length} 条（缺 id/url/name）：${skipped.join(', ')}`);
  }

  if (STDOUT) {
    console.log(sql);
    console.error(`\n— 共生成 ${apps.length - skipped.length} 条 INSERT（可重复执行）`);
  } else {
    writeFileSync(path.resolve(process.cwd(), OUT), sql, 'utf8');
    console.log(`✓ 已写入 ${OUT}（${apps.length - skipped.length} 条，跳 ${skipped.length} 条）`);
    console.log(`  执行：wrangler d1 execute qingwu --remote --file=./${path.basename(OUT)}`);
  }
}

main();
