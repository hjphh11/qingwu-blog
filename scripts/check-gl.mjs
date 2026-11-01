/**
 * 第 4 条「光场内核」验收。
 *
 * 四项对应方案原文：
 *   ① 首页场景能跑起来（帧数持续增长 + 渲染预算在范围内）
 *   ② 四场景切换无白闪（沿用 P0 的截图字节数法）
 *   ③ 切后台停渲染（P0 的 2.3.6 唯一不通过项，本条的必修项）
 *   ④ 掉帧自动降档一次
 *
 * 用法：node scripts/check-gl.mjs   （需要 dist/client 已构建，且 4399 端口有静态服务）
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/hjiap/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const BASE = 'http://127.0.0.1:4399';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function verdict(ok, label, detail) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--no-proxy-server',
    '--proxy-bypass-list=127.0.0.1;localhost',
    // SwiftShader 下 WebGL 才能起来（headless 没有真 GPU）
    '--enable-unsafe-swiftshader',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 140)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !t.includes('favicon') && !t.includes('hydration')) errors.push('console: ' + t.slice(0, 140));
});

/* ── ① 画布存在、帧数增长、预算在范围内 ────────────────────── */
await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 40000 });
await sleep(2500);

const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('#gl-layer canvas');
  const g = window.__qGl;
  return {
    hasLayer: !!document.querySelector('#gl-layer'),
    hasCanvas: !!c,
    size: c ? { w: c.width, h: c.height } : null,
    frames: g ? g.frames : -1,
    state: g ? g.state() : null,
    info: g && g.info ? g.info() : null,
  };
});

verdict(canvasInfo.hasLayer, '#gl-layer 存在（persist 容器）');
verdict(canvasInfo.hasCanvas, '<canvas> 已挂载');
verdict(canvasInfo.frames > 30, '首页帧数在增长', `frames=${canvasInfo.frames}`);
verdict(
  canvasInfo.info && canvasInfo.info.calls <= 40,
  'draw calls ≤ 40（桌面预算）',
  canvasInfo.info ? `calls=${canvasInfo.info.calls} points=${canvasInfo.info.points} dpr=${canvasInfo.info.dpr}` : 'n/a',
);
console.log('        初始状态:', JSON.stringify(canvasInfo.state));

/* ── 光场真的画出了东西（而不是一块空透明画布）────────────────
   放在 /about/ 上比：首页有笔顺动画在跑，截两次字节数差得离谱（方向都可能反），
   那个比较没有意义。关于页画面是静态的，切换 gl-layer 的显隐才是公平对照。 */
await page.evaluate(() => {
  const a = document.createElement('a');
  a.href = '/about/';
  document.body.appendChild(a);
  a.click();
});
await sleep(2600); // 等揭示动画与滚动淡入结束

const withGl = await page.screenshot({ encoding: 'binary' });
await page.evaluate(() => {
  document.getElementById('gl-layer').style.display = 'none';
});
await sleep(500);
const withoutGl = await page.screenshot({ encoding: 'binary' });
await page.evaluate(() => {
  document.getElementById('gl-layer').style.display = '';
});
const delta = Math.abs(withGl.length - withoutGl.length) / Math.max(withGl.length, 1);
verdict(
  withGl.length > withoutGl.length * 1.01,
  '光场对画面有实际贡献',
  `有光场 ${(withGl.length / 1024).toFixed(0)}KB > 无光场 ${(withoutGl.length / 1024).toFixed(0)}KB（差 ${(delta * 100).toFixed(1)}%）`,
);

/* ── ② 四场景切换无白闪 ───────────────────────────────────── */
// 客户端路由切页，连拍截图看有没有纯色帧（纯白 PNG 压缩后只有几 KB）
const routes = [
  ['/blog/', 'reading'],
  ['/music/', 'sound'],
  ['/about/', 'projects'],
  ['/', 'home'],
];

for (const [path, expectScene] of routes) {
  await page.evaluate((p) => {
    const a = document.createElement('a');
    a.href = p;
    document.body.appendChild(a);
    a.click();
  }, path);

  const sizes = [];
  for (let i = 0; i < 6; i++) {
    await sleep(110);
    const buf = await page.screenshot({ encoding: 'binary' });
    sizes.push(buf.length);
  }
  await sleep(700);

  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  const scene = await page.evaluate(() => (window.__qGl ? window.__qGl.state().scene : null));

  verdict(scene === expectScene, `${path} 场景正确`, `期望 ${expectScene} 实际 ${scene}`);
  /* 「白闪」的判据用**绝对字节数**，不用相对比例：
     1280×800 的一帧如果接近纯色，PNG 只有几 KB ~ 20KB 量级。
     拿 min/max 比值判会误报 —— 光的过渡帧本身就比静止帧复杂得多
     （实测 200KB vs 1.29MB），比值 0.15 不代表画面空了。
     所以只要没有任何一帧掉到「像纯色」的量级，就认定没有白闪。 */
  verdict(min > 60_000, `${path} 无白闪`, `最空一帧 ${(min / 1024).toFixed(0)}KB（纯色帧约 5~20KB）`);
}

/* ── ③ 切后台停渲染 ───────────────────────────────────────── */
const beforeHide = await page.evaluate(() => window.__qGl.frames);
await page.evaluate(() => {
  // headless 里没法真的切标签页，这里直接改 document.hidden 再派发事件 ——
  // 测的是「Layout 的事件 → store → frameloop」这条链路，浏览器是否派发事件不在测试范围
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await sleep(1200);
const afterHide = await page.evaluate(() => window.__qGl.frames);

await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
});
await sleep(900);
const afterShow = await page.evaluate(() => window.__qGl.frames);

verdict(afterHide - beforeHide <= 2, '隐藏后帧数停止', `隐藏期间增量 ${afterHide - beforeHide}`);
verdict(afterShow - afterHide > 5, '回到前台后恢复渲染', `恢复后增量 ${afterShow - afterHide}`);

/* ── ④ 掉帧自动降档（只降一次）───────────────────────────── */
// 用忙等把每帧撑到 ~40ms，持续到累计慢帧时超过 2s
await page.evaluate(() => {
  window.__stopBurn = false;
  const burn = () => {
    const t = performance.now();
    while (performance.now() - t < 40) {
      /* 占住主线程，制造慢帧 */
    }
    if (!window.__stopBurn) requestAnimationFrame(burn);
  };
  requestAnimationFrame(burn);
});
await sleep(3500);
await page.evaluate(() => {
  window.__stopBurn = true;
});

const wd = await page.evaluate(() => ({
  fired: !!window.__qGl.watchdogFired,
  tier: window.__qGl.state().tier,
}));
verdict(wd.fired, '慢帧看守触发过', `tier=${wd.tier}`);
verdict(wd.tier === 'low', '降档后落在 low 档', `tier=${wd.tier}`);

console.log('\n浏览器错误:', errors.length ? '\n  ' + errors.slice(0, 6).join('\n  ') : '（无）');
console.log(`\n合计失败 ${failed} 项`);
await browser.close();
process.exit(failed ? 1 : 0);
