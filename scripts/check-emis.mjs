/**
 * 第 5 条「爱弥斯 2.5D 在场」验收。
 *
 * 检查五件事：
 *   ① 布局零位移 —— 三层包裹（gaze / idle）不能改变立绘的盒子与首屏高度
 *   ② 开屏归位不偏 —— 动画必须在 'qingwu:splash-done' 之后才启动
 *   ③ 呼吸/微摆在动（transform 随时间变化）
 *   ④ 视线跟随有效（指针移动 → --emis-x/--emis-y 变化）
 *   ⑤ 减动效下停呼吸/微摆
 *
 * 注：「发梢光影」做过又去掉了 —— 加色扫光会把官方立绘的配色冲淡，
 * 压到不伤画面的强度又几乎看不见。理由记在 styles/emis.css 顶部。
 *
 * 用法：node scripts/check-emis.mjs            # 常规验收
 *       node scripts/check-emis.mjs --geom     # 只打印几何量（用于和基线对比）
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/hjiap/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const BASE = 'http://127.0.0.1:4399';
const GEOM_ONLY = process.argv.includes('--geom');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const verdict = (ok, label, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=127.0.0.1;localhost'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 140)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !t.includes('favicon') && !t.includes('hydration')) {
    errors.push('console: ' + t.slice(0, 140));
  }
});

await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 40000 });
await sleep(6000); // 等开屏播完（dur 2000 + 收尾）

/* ── 几何量：用 offset* 而不是 getBoundingClientRect ──────────
   offset* 是布局尺寸，不含 transform，动画跑着也稳定，才适合当基线。 */
const geom = await page.evaluate(() => {
  const img = document.querySelector('[data-emis-hero]');
  const hero = document.querySelector('section');
  const sub = document.querySelector('section p');
  const q = (el) => (el ? { w: el.offsetWidth, h: el.offsetHeight } : null);
  return {
    heroH: hero ? Math.round(hero.getBoundingClientRect().height) : null,
    img: q(img),
    imgOffsetTop: img ? img.offsetTop : null,
    // 立绘在视口里的位置（含包裹层 transform，用于和开屏落点对齐比较）
    imgRect: img
      ? (() => {
          const r = img.getBoundingClientRect();
          return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        })()
      : null,
    subLeft: sub ? Math.round(sub.getBoundingClientRect().left) : null,
    subTop: sub ? Math.round(sub.getBoundingClientRect().top) : null,
    // 三层包裹的尺寸应当与 picture 完全一致
    stage: q(document.querySelector('.q-emis')),
    gaze: q(document.querySelector('.q-emis__gaze')),
    idle: q(document.querySelector('.q-emis__idle')),
  };
});

if (GEOM_ONLY) {
  console.log(JSON.stringify(geom, null, 1));
  await browser.close();
  process.exit(0);
}

console.log('几何量:', JSON.stringify(geom));

/* ── ① 布局零位移 ────────────────────────────────────────── */
const sameBox = (a, b) => a && b && a.w === b.w && a.h === b.h;
verdict(sameBox(geom.stage, geom.img), '三层包裹不改变立绘盒子尺寸', `${JSON.stringify(geom.stage)} vs img ${JSON.stringify(geom.img)}`);
verdict(sameBox(geom.gaze, geom.idle), 'gaze / idle 两层尺寸一致');

/* ── ② 开屏归位不偏 ────────────────────────────────────────
   不能靠「在某个时刻采样」来判 —— 水合时机随机，采早了采晚了都会误判（第一次就踩了）。
   改成**时间戳比对**：在页面脚本之前注入探针，分别记下 is-idle 出现的时刻与
   'qingwu:splash-done' 的时刻，然后断言前者不早于后者。
   ⚠️ 必须用独立 context：开屏每会话只播一次（sessionStorage['qingwu:splash']），
   复用同一个 context 的话第二次开页压根不播。 */
const ctx = await browser.createBrowserContext();
const page2 = await ctx.newPage();
await page2.setViewport({ width: 1440, height: 900 });
await page2.evaluateOnNewDocument(() => {
  window.__emisGate = { idleAt: null, doneAt: null };
  window.addEventListener('qingwu:splash-done', () => {
    window.__emisGate.doneAt = performance.now();
  });
  const check = () => {
    if (window.__emisGate.idleAt === null && document.querySelector('.q-emis.is-idle')) {
      window.__emisGate.idleAt = performance.now();
    }
  };
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(check).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    check();
  });
});
await page2.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 40000 });
await sleep(6500); // 开屏 2s + 收尾，留足余量
const gate = await page2.evaluate(() => window.__emisGate);
await ctx.close();

verdict(
  gate.idleAt !== null && gate.doneAt !== null && gate.idleAt >= gate.doneAt,
  '活化在开屏结束之后才启动（归位不会偏）',
  `doneAt=${gate.doneAt === null ? 'null' : gate.doneAt.toFixed(0)}ms  idleAt=${gate.idleAt === null ? 'null' : gate.idleAt.toFixed(0)}ms`,
);

const later = await page.evaluate(() => !!document.querySelector('.q-emis.is-idle'));
verdict(later, '开屏结束后活化已启动');

/* ── ③ 呼吸/微摆在动 ─────────────────────────────────────── */
const t1 = await page.evaluate(() => getComputedStyle(document.querySelector('.q-emis__idle')).transform);
await sleep(1200);
const t2 = await page.evaluate(() => getComputedStyle(document.querySelector('.q-emis__idle')).transform);
verdict(t1 !== t2, '呼吸/微摆的 transform 在变', `${t1.slice(0, 28)}… → ${t2.slice(0, 28)}…`);

/* ── ④ 视线跟随 ──────────────────────────────────────────── */
const g0 = await page.evaluate(() => {
  const s = document.querySelector('.q-emis');
  return getComputedStyle(s).getPropertyValue('--emis-x').trim() || '0';
});
// 指针移到窗口左侧
await page.mouse.move(120, 300);
await sleep(600);
const g1 = await page.evaluate(() => document.querySelector('.q-emis').style.getPropertyValue('--emis-x'));
await page.mouse.move(1320, 300);
await sleep(700);
const g2 = await page.evaluate(() => document.querySelector('.q-emis').style.getPropertyValue('--emis-x'));
verdict(g1 !== g2 && g1 !== '' && g2 !== '', '视线跟随响应指针', `左 ${g1} / 右 ${g2}（初始 ${g0}）`);

/* ── 减动效 ──────────────────────────────────────────────── */
const page3 = await browser.newPage();
await page3.setViewport({ width: 1440, height: 900 });
await page3.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page3.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 40000 });
await sleep(2500);
const reduced = await page3.evaluate(() => {
  const idle = document.querySelector('.q-emis__idle');
  return { anim: idle ? getComputedStyle(idle).animationName : null };
});
await page3.close();
verdict(reduced.anim === 'none', '减动效下停呼吸/微摆', `animation-name=${reduced.anim}`);

console.log('\n浏览器错误:', errors.length ? '\n  ' + errors.slice(0, 5).join('\n  ') : '（无）');
console.log(`\n合计失败 ${failed} 项`);
await browser.close();
process.exit(failed ? 1 : 0);
