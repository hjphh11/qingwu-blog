#!/usr/bin/env node
// 一条命令起「后台本地预览」需要的两个进程。
//
//   npm run dev:admin
//
// 为什么不是一个 npm script 里塞两个命令：Windows 的 `&` / `&&` 在 cmd 和 bash
// 下语义不一样，还要保证 Ctrl+C 能一起收掉。这里直接 spawn 两个子进程，退出时
// 按进程树 Kill，避免留下孤儿 workerd 抢端口 —— 那个坑踩过：多个 wrangler dev
// 叠在同一端口上，请求会落到没加载新代码的那个实例，表现为「改了没生效」。
//
// 起完访问：http://127.0.0.1:4321/api/admin/dev-login?token=<worker/.dev.vars 里的 ADMIN_DEV_LOGIN>
// 它会 302 到 /admin/console，cookie 一宿有效（会话 30 天，本地库删了重来即可）。

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PORT = 8799;
const WEB_PORT = 4321;

/** 端口上有没有人在听 —— 用来提前拦住「两个 dev 叠着跑」 */
function isBusy(port) {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port });
    s.setTimeout(600);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('timeout', () => {
      s.destroy();
      resolve(false);
    });
    s.once('error', () => resolve(false));
  });
}

/** 从 .dev.vars 读一键登录口令；读不到就只提示地址，不让脚本失败 */
function devToken() {
  try {
    const txt = readFileSync(join(ROOT, 'worker', '.dev.vars'), 'utf8');
    const m = txt.match(/^ADMIN_DEV_LOGIN=(.+)$/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

const [workerBusy, webBusy] = await Promise.all([isBusy(WORKER_PORT), isBusy(WEB_PORT)]);
if (workerBusy || webBusy) {
  console.error(
    `\n  ${workerBusy ? `端口 ${WORKER_PORT} 已被占用（大概还有个 wrangler dev）\n  ` : ''}` +
      `${webBusy ? `端口 ${WEB_PORT} 已被占用（大概还有个 astro dev）` : ''}\n\n` +
      '  先把旧的收掉再来：\n' +
      `    PowerShell: Get-NetTCPConnection -LocalPort ${workerBusy ? WORKER_PORT : WEB_PORT} -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }\n`,
  );
  process.exit(1);
}

const children = [];
function run(label, command, cwd) {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const tag = `[${label}]`;
  const pipe = (stream, isErr) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        // wrangler 的启动清单很长，只留有用的几行
        if (/^\s*env\./.test(line)) continue;
        (isErr ? process.stderr : process.stdout).write(`${tag} ${line}\n`);
      }
    });
  };
  pipe(child.stdout, false);
  pipe(child.stderr, true);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`${tag} 退出，code=${code}`);
    shutdown();
  });
  return child;
}

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // shell:true 下 pid 是 cmd.exe，得连子进程一起收
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      c.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(0), 400);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('\n  起两个进程：');
console.log(`    · Worker  http://127.0.0.1:${WORKER_PORT}  （数据、接口、D1 本地库）`);
console.log(`    · 页面    http://127.0.0.1:${WEB_PORT}  （astro dev，改组件即时热更新）\n`);

run('worker', `npx wrangler dev --port ${WORKER_PORT} --local`, join(ROOT, 'worker'));
run('web', 'npx astro dev', ROOT);

// 等页面起来再把地址打出来，省得用户盯着日志猜
const token = devToken();
let waited = 0;
const timer = setInterval(async () => {
  waited += 1000;
  if (await isBusy(WEB_PORT)) {
    clearInterval(timer);
    console.log('\n  ————————————————————————————————————————————————');
    console.log('  打开这个地址即登录（一次性，进后台后正常用）：\n');
    if (token) {
      console.log(`    http://127.0.0.1:${WEB_PORT}/api/admin/dev-login?token=${token}\n`);
    } else {
      console.log('    worker/.dev.vars 里没有 ADMIN_DEV_LOGIN —— 只能走正常登录\n');
    }
    console.log('  改完想上线：先 `git diff` 看一遍，说一声我再合回 main。');
    console.log('  ————————————————————————————————————————————————\n');
  } else if (waited > 90_000) {
    clearInterval(timer);
    console.log('\n  页面 90 秒还没起来，看上面 [web] 的报错。\n');
  }
}, 1000);
