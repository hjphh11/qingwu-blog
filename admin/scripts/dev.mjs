// 开发模式：同时起 Express（API :3000）与 Vite（前端 :5173，/api 代理到 3000）。
//
//   cd admin && npm run dev      然后打开 http://127.0.0.1:5173
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(__dirname, '..');
const envFile = path.join(adminRoot, '.env');
const viteBin = path.join(adminRoot, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(envFile)) {
  console.error('\n[dev] 找不到 admin/.env');
  console.error('[dev] 请先：copy admin\\.env.example admin\\.env  然后填好里面的两项\n');
  process.exit(1);
}

// --watch：改了服务端代码自动重启（不用手动停起）
const nodeArgs = ['--watch', '--env-file', envFile];
const api = spawn(process.execPath, [...nodeArgs, 'server/index.js'], {
  cwd: adminRoot,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
});

const vite = spawn(process.execPath, [viteBin, '--config', 'web/vite.config.js'], {
  cwd: adminRoot,
  stdio: 'inherit',
  env: process.env,
});

let closing = false;
const shutdown = (code = 0) => {
  if (closing) return;
  closing = true;
  api.kill();
  vite.kill();
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
api.on('exit', (code) => {
  console.log(`[dev] API 退出（code ${code}）`);
  shutdown(code ?? 0);
});
vite.on('exit', (code) => {
  console.log(`[dev] Vite 退出（code ${code}）`);
  shutdown(code ?? 0);
});

console.log('[dev] API  -> http://127.0.0.1:3000');
console.log('[dev] 前端 -> http://127.0.0.1:5173   ← 打开这个');
