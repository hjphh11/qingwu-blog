#!/usr/bin/env node
// 清吾 · 一次性迁移：把历史留言按邮箱归并到 accounts
//
// 设计见 docs/方案-统一身份-登录与绑定.md 第 5 节。要点：
//   · **分组键是邮箱指纹** md5(lower(trim(email)))，与 src/lib/avatar.ts / worker/src/auth/md5.ts 同源
//   · 只补 `comments.account_id`，**不改任何行内容**（唯一的例外见下）
//   · 幂等：已经挂上 account_id 的行不会再动；账号按 email UNIQUE 去重
//   · 默认 **dry-run**，只打印统计；加 `--apply` 才写库
//
// 用法（在 worker/ 下）：
//   node scripts/migrate-accounts.mjs                 # 看统计（本地库）
//   node scripts/migrate-accounts.mjs --apply         # 真的写（本地库）
//   node scripts/migrate-accounts.mjs --remote        # 对 Cloudflare 那份（已归档只读，写会 410）
//   node scripts/migrate-accounts.mjs --db /path/x.db # 直接指定 sqlite 文件（生产机上用）
//
// ⚠️ 生产：先 `systemctl stop qingwu-api` → 备份 db → 跑这个 → `systemctl start qingwu-api`。
//    workerd 有自己的 sqlite 句柄，热着改库它看不到（与 admin_sessions 那个坑同源）。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(HERE, '..');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const REMOTE = argv.includes('--remote');
const dbFlag = argv.indexOf('--db');
const DB_FILE = dbFlag >= 0 ? argv[dbFlag + 1] : '';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

/** 与 worker/src/auth/md5.ts、src/lib/avatar.ts 完全一致的口径 */
const normEmail = (raw) => String(raw ?? '').trim().toLowerCase();
const hashOf = (email) => createHash('md5').update(normEmail(email), 'utf8').digest('hex');
const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;

/**
 * 读一段 SQL。
 *
 * 两条通道：
 *   · `--db`：直接用 node:sqlite 打开文件（生产机上最省事，Node 22.5+ 需要 --experimental-sqlite）
 *   · 否则：走 wrangler d1 execute --json（本地 .wrangler 状态 / 远端都走这条）
 */
async function query(sql) {
  if (DB_FILE) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(DB_FILE, { readOnly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  }
  const args = ['d1', 'execute', 'qingwu', '--json', '--command', sql];
  args.push(REMOTE ? '--remote' : '--local');
  const out = execFileSync(process.execPath, [join(WORKER, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args], {
    cwd: WORKER,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  const start = out.indexOf('[');
  if (start < 0) throw new Error(`wrangler 没回 JSON：${out.slice(0, 300)}`);
  const parsed = JSON.parse(out.slice(start));
  // 形状：[{ results: [...], success, meta }]，也有版本直接给数组
  if (Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].results)) return parsed[0].results;
  if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'object' && !('results' in x))) return parsed;
  return [];
}

async function applySql(sql) {
  if (DB_FILE) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(DB_FILE);
    try {
      db.exec('BEGIN');
      db.exec(sql);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.close();
    }
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'qingwu-mig-'));
  const file = join(dir, 'migrate.sql');
  // 事务在这边包一层：DB_FILE 路径用 sqlite 的 API 包，wrangler 路径用 SQL 包
  writeFileSync(file, `BEGIN;\n${sql}\nCOMMIT;\n`, 'utf8');
  const args = ['d1', 'execute', 'qingwu', '--file', file];
  args.push(REMOTE ? '--remote' : '--local');
  execFileSync(process.execPath, [join(WORKER, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args], {
    cwd: WORKER,
    encoding: 'utf8',
    stdio: 'inherit',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
}

async function main() {
  console.log(c.bold('\n清吾 · 统一身份迁移'), c.dim(APPLY ? '（会写库）' : '（dry-run，只统计）'));
  if (DB_FILE) {
    if (!existsSync(DB_FILE)) {
      console.error(c.red(`\n找不到数据库文件：${DB_FILE}`));
      process.exit(1);
    }
    console.log(c.dim(`库：${DB_FILE}`));
  } else {
    console.log(c.dim(`库：wrangler ${REMOTE ? '--remote' : '--local'}`));
  }
  if (REMOTE) console.log(c.yellow('⚠️  Cloudflare 那份是归档只读的，写入会被 410 拒绝。'));

  // ① 有没有 account_id 列（0023 跑没跑）
  let hasAccountCol = true;
  try {
    await query('SELECT account_id FROM comments LIMIT 1');
  } catch {
    hasAccountCol = false;
  }
  if (!hasAccountCol) {
    console.error(c.red('\ncomments.account_id 还不存在 —— 先跑 0023_accounts.sql：'));
    console.error('  node ../node_modules/wrangler/bin/wrangler.js d1 migrations apply qingwu --local\n');
    process.exit(1);
  }

  // ② 读留言（只读必要字段；邮箱可能为空但指纹在）
  const rows = await query(
    `SELECT id, email, email_hash, author, author_url, avatar, ts, account_id
       FROM comments
      WHERE email_hash IS NOT NULL AND email_hash != ''
      ORDER BY ts ASC`,
  );
  const total = (await query('SELECT COUNT(*) AS n FROM comments'))[0]?.n ?? 0;
  const withHash = rows.length;
  console.log(c.dim(`\n留言 ${total} 条，其中带邮箱指纹 ${withHash} 条，孤儿（无邮箱）${total - withHash} 条`));

  // ③ 分组：以「从邮箱重算出来的指纹」为准
  //
  // 为什么不直接信库里的 email_hash：那是前端算的，历史上有过大小写/空格不统一。
  // 以明文邮箱重算一次，不一致的顺手报出来（并修正），否则同一个人会被拆成两个账号。
  const groups = new Map(); // hash -> { email, rows: [], name, site, avatar }
  let hashFixed = 0;
  let noPlainEmail = 0;

  for (const r of rows) {
    const email = normEmail(r.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      noPlainEmail += 1;
      continue;
    }
    const h = hashOf(email);
    if (r.email_hash !== h) hashFixed += 1;

    const g = groups.get(h) ?? { email, rows: [], name: '', site: '', avatar: '', ts: 0 };
    g.rows.push(r);
    // 署名/站点/头像取「该邮箱最近一条」的值；站点与头像再退一步取最近的非空值
    if (r.ts >= g.ts) {
      g.ts = r.ts;
      if (r.author) g.name = r.author;
    }
    if (!g.site && r.author_url) g.site = r.author_url;
    if (!g.avatar && r.avatar) g.avatar = r.avatar;
    groups.set(h, g);
  }

  const orphanByNoEmail = noPlainEmail;

  // ④ 管理员也要进 accounts（role='admin'）
  let admins = [];
  try {
    admins = await query('SELECT id, username, email, pass_hash, salt, iterations FROM admin_users');
  } catch {
    console.log(c.dim('没读到 admin_users（可能已删），跳过管理员迁移'));
  }

  console.log(c.bold(`\n将建/补 ${groups.size} 个访客账号，管理员 ${admins.length} 个`));
  if (hashFixed) console.log(c.yellow(`  其中 ${hashFixed} 条留言的 email_hash 与「邮箱重算值」不一致，会顺手修正`));
  if (orphanByNoEmail) {
    console.log(c.dim(`  ${orphanByNoEmail} 条有指纹但没有可读邮箱（早期数据），保持孤儿`));
  }

  const preview = [...groups.values()].slice(0, 5);
  for (const g of preview) {
    console.log(c.dim(`  · ${g.email}  →  ${g.name || '（无名）'} · ${g.rows.length} 条留言`));
  }
  if (groups.size > preview.length) console.log(c.dim(`  · …还有 ${groups.size - preview.length} 个`));

  // ⑤ 生成 SQL（按 email 反查 id，不硬编码自增值）
  const now = Date.now();
  const lines = [];

  for (const [h, g] of groups) {
    lines.push(
      `INSERT INTO accounts (email, email_hash, display_name, site_url, avatar_url, role, created_at, last_seen_at)
       VALUES (${q(g.email)}, ${q(h)}, ${q(g.name || null)}, ${q(g.site || null)}, ${q(g.avatar || null)}, 'visitor', ${now}, ${now})
       ON CONFLICT(email) DO NOTHING;`,
    );
    // 邮箱本身就是一条 identity —— 绑定列表里要能看到「邮箱」这一项
    lines.push(
      `INSERT INTO account_identities (account_id, provider, uid, created_at, last_used_at)
       SELECT id, 'email', email, ${now}, ${now} FROM accounts WHERE email = ${q(g.email)}
       ON CONFLICT(provider, uid) DO NOTHING;`,
    );
    // 只挂还没归属的（幂等）
    lines.push(
      `UPDATE comments SET account_id = (SELECT id FROM accounts WHERE email = ${q(g.email)})
        WHERE account_id IS NULL AND id IN (${g.rows.map((r) => r.id).join(',')});`,
    );
    if (hashFixed) {
      const bad = g.rows.filter((r) => r.email_hash !== h);
      if (bad.length) {
        lines.push(
          `UPDATE comments SET email_hash = ${q(h)} WHERE id IN (${bad.map((r) => r.id).join(',')});`,
        );
      }
    }
  }

  for (const a of admins) {
    const email = normEmail(a.email);
    if (!email) continue;
    lines.push(
      `INSERT INTO accounts (email, email_hash, display_name, role, pass_hash, salt, iterations, created_at)
       VALUES (${q(email)}, ${q(hashOf(email))}, ${q(a.username)}, 'admin', ${q(a.pass_hash)}, ${q(a.salt)}, ${Number(a.iterations) || 150000}, ${now})
       ON CONFLICT(email) DO UPDATE SET
         role = 'admin',
         pass_hash = excluded.pass_hash,
         salt = excluded.salt,
         iterations = excluded.iterations,
         display_name = COALESCE(accounts.display_name, excluded.display_name);`,
    );
  }

  const sql = `${lines.join('\n')}\n`;

  if (!APPLY) {
    const out = join(WORKER, 'scripts', 'migrate-accounts.dryrun.sql');
    writeFileSync(out, `BEGIN;\n${sql}\nCOMMIT;\n`, 'utf8');
    console.log(c.yellow(`\ndry-run：SQL 已写到 ${out}`));
    console.log(c.dim(`  ${lines.length} 条语句。确认无误后加 --apply 执行。\n`));
    return;
  }

  await applySql(sql);
  console.log(c.green('\n写库完成，开始校验…'));

  // ⑥ 校验：归属率 + 账号数
  const after = await query(
    `SELECT
       (SELECT COUNT(*) FROM accounts) AS accounts,
       (SELECT COUNT(*) FROM accounts WHERE role = 'admin') AS admins,
       (SELECT COUNT(*) FROM comments) AS comments,
       (SELECT COUNT(*) FROM comments WHERE account_id IS NOT NULL) AS linked,
       (SELECT COUNT(*) FROM account_identities) AS identities`,
  );
  const s = after[0] ?? {};
  console.log(
    `  账号 ${s.accounts}（管理员 ${s.admins}）· 留言 ${s.comments} · 已归属 ${s.linked}` +
      ` · 身份 ${s.identities}`,
  );
  console.log(
    c.dim(`  未归属 ${Number(s.comments) - Number(s.linked)} 条 —— 应等于「没有邮箱的孤儿」数量。\n`),
  );
}

main().catch((err) => {
  console.error(c.red(`\n失败：${err instanceof Error ? err.message : err}\n`));
  process.exit(1);
});
