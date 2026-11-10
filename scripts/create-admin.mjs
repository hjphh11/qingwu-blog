#!/usr/bin/env node
// 创建 / 重置后台管理员
//
// 用法（在仓库根跑）：
//   node scripts/create-admin.mjs                          # 交互式，密码随机生成
//   node scripts/create-admin.mjs admin me@example.com 我的密码
//
// 它只做一件事：算出 PBKDF2 哈希，打印一条可以直接喂给 wrangler 的 SQL。
// **不直接连库** —— 库在服务器上，脚本不该假设自己在哪台机器上跑。
//
// ⚠️ 迭代次数必须和 worker/src/admin/auth.ts 的 PBKDF2_ITER 一致，
//    否则写进去的哈希永远验不过（症状：密码明明对，登录页一直说"账号或密码不正确"）。

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const ITER = 150_000;

/** 够用就行：大小写 + 数字，去掉容易看错的 0/O/1/l/I */
function randomPassword(len = 16) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += abc[buf[i] % abc.length];
  return s;
}

function sqlQuote(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  let [username, email, password] = process.argv.slice(2);

  if (!username || !email) {
    const rl = createInterface({ input: stdin, output: stdout });
    username = username || (await rl.question('管理员账号（英文/数字）：')).trim();
    email = email || (await rl.question('接收验证码的邮箱：')).trim();
    await rl.close();
  }

  if (!username || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    console.error('账号只能是 3~32 位英文、数字、下划线、点或连字符');
    process.exit(1);
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('邮箱格式不对');
    process.exit(1);
  }

  const generated = !password;
  if (generated) password = randomPassword();

  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, ITER, 32, 'sha256').toString('hex');

  const sql = `-- 由 scripts/create-admin.mjs 生成（${new Date().toISOString()}）
-- 已被同名的会直接覆盖密码与邮箱，可反复执行
INSERT INTO admin_users (username, email, pass_hash, salt, iterations, created_at)
VALUES (${sqlQuote(username)}, ${sqlQuote(email)}, ${sqlQuote(hash)}, ${sqlQuote(salt)}, ${ITER}, ${Date.now()})
ON CONFLICT(username) DO UPDATE SET
  email      = excluded.email,
  pass_hash  = excluded.pass_hash,
  salt       = excluded.salt,
  iterations = excluded.iterations;
`;
  const out = 'scripts/create-admin.sql';
  writeFileSync(out, sql, 'utf8');

  console.log('');
  console.log('  账号：' + username);
  console.log('  邮箱：' + email);
  if (generated) {
    console.log('  密码：' + password + '   ← 只显示这一次，自己存好');
  } else {
    console.log('  密码：（你刚才输入的那个）');
  }
  console.log('');
  console.log('  SQL 已写到 ' + out + '，在**服务器上**执行：');
  console.log('');
  console.log('    cd /data/qingwu/worker');
  console.log('    node node_modules/wrangler/bin/wrangler.js d1 execute qingwu --local --file ../scripts/create-admin.sql');
  console.log('');
  console.log('  执行完记得删掉那个文件（里面有密码哈希与盐）：');
  console.log('    rm -f /data/qingwu/scripts/create-admin.sql');
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
