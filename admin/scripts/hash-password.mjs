// 生成密码的 argon2 哈希，写进 admin/.env（或服务器 /opt/qingwu/.env）。
//
//   cd admin
//   npm run hash-password -- 你的密码
//
// 后台**只认哈希**，不存明文密码。
import { hashPassword } from '../server/auth.js';

const password = process.argv.slice(2).join(' ');

if (!password) {
  console.error('用法：npm run hash-password -- 你的密码');
  process.exit(1);
}
if (password.length < 8) {
  console.error('密码至少 8 位（这是唯一的第二道锁，别太短）');
  process.exit(1);
}

const hash = await hashPassword(password);
console.log('\n把下面这行写进 admin/.env（本地）或 /opt/qingwu/.env（服务器）：\n');
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log('\n（哈希里含 $ 等字符，.env 里不要加引号，直接整行粘贴即可）\n');
