/**
 * 第 6 条 §6.3 验收清单（客观项）。
 *
 * 逐条对应方案原文：
 *   ① 开屏每会话一次，刷新不重播，新标签重播
 *   ② 5s 兜底：模块 JS 挂了也要自己收幕，页面可用
 *   ③ 跳转其它页面再返回，开屏不重播
 *   ④ 1440 / 1024 / 390 三档无横向溢出
 *   ⑤ prefers-reduced-motion 下开场无位移，直接显示结果态
 *
 * 用法：node scripts/check-home.mjs
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/hjiap/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const BASE = 'http://127.0.0.1:4399';
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

const splashVisible = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.q-splash');
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01;
  });

const pending = (page) =>
  page.evaluate(() => document.documentElement.classList.contains('q-splash-pending'));

/* ── ① 每会话一次：首访播、刷新不播、新标签播 ───────────── */
{
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });

  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(600);
  const first = await splashVisible(p);
  verdict(first, '首次访问会播开屏');

  await sleep(3200); // 等它收完
  const flag = await p.evaluate(() => sessionStorage.getItem('qingwu:splash'));
  verdict(!!flag, '开屏结束后写入会话标记', `qingwu:splash=${flag}`);

  // 刷新：同一标签页、同一 sessionStorage
  await p.reload({ waitUntil: 'domcontentloaded' });
  await sleep(600);
  const afterReload = await splashVisible(p);
  verdict(!afterReload, '刷新不重播');

  // 新标签：同一 context 里的新页面共享 sessionStorage，所以这里要开新 context 才算「新会话」
  const ctx2 = await browser.createBrowserContext();
  const p2 = await ctx2.newPage();
  await p2.setViewport({ width: 1440, height: 900 });
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(600);
  const newTab = await splashVisible(p2);
  verdict(newTab, '新会话（新标签）会重播');
  await ctx2.close();
  await ctx.close();
}

/* ── ② 5s 兜底 ──────────────────────────────────────────────
   把模块 JS 全部拦掉，模拟「打包失败 / 被拦 / 断网」。
   Layout 里那两段 is:inline 脚本仍然会跑，所以幕布必须能自己收。 */
{
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    if (/_astro\/.*\.js$/.test(req.url())) req.abort();
    else req.continue();
  });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  const rightAfter = await pending(p);
  await sleep(6200); // 兜底是 5s
  const later = await pending(p);
  const bodyVisible = await p.evaluate(() => {
    const t = document.querySelector('h1, .page-shell');
    if (!t) return false;
    const r = t.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  verdict(rightAfter, '模块 JS 被拦后幕布仍会先铺上（首帧不闪内容）', `pending=${rightAfter}`);
  verdict(!later, '5s 兜底把幕布收掉', `pending=${later}`);
  verdict(bodyVisible, '页面内容可用（没被锁死）');
  await ctx.close();
}

/* ── ③ 跳转再返回不重播 ──────────────────────────────────── */
{
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(3500);

  await p.evaluate(() => {
    const a = document.createElement('a');
    a.href = '/about/';
    document.body.appendChild(a);
    a.click();
  });
  await sleep(1500);
  const onAbout = await splashVisible(p);

  await p.evaluate(() => {
    const a = document.createElement('a');
    a.href = '/';
    document.body.appendChild(a);
    a.click();
  });
  await sleep(1500);
  const backHome = await splashVisible(p);
  verdict(!onAbout && !backHome, '客户端路由来回都不重播', `about=${onAbout} home=${backHome}`);
  await ctx.close();
}

/* ── ④ 三档无横向溢出 ────────────────────────────────────── */
{
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  for (const w of [1440, 1024, 390]) {
    await p.setViewport({ width: w, height: 900 });
    await p.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 40000 });
    await sleep(900);
    const m = await p.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
      // 找出真正越界的元素，报出来方便定位
      over: Array.from(document.querySelectorAll('body *'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > window.innerWidth + 1.5;
        })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').slice(0, 40)}`),
    }));
    verdict(m.sw <= m.iw + 1, `${w}px 无横向溢出`, `scrollWidth=${m.sw} innerWidth=${m.iw}${m.over.length ? ' 越界:' + m.over.join(' | ') : ''}`);
  }
  await ctx.close();
}

/* ── ⑤ 减动效：开场无位移，直接结果态 ────────────────────── */
{
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(1500);
  const r = await p.evaluate(() => {
    // 立绘在减动效下不应该有位移/缩放动画；笔顺直接是完整静态字
    const img = document.querySelector('[data-emis-hero]');
    const cells = document.querySelectorAll('.char-cell');
    const painted = Array.from(cells).filter((c) => (c.textContent || '').trim().length > 0).length;
    return {
      idle: !!document.querySelector('.q-emis.is-idle'),
      idleAnim: document.querySelector('.q-emis__idle') ? getComputedStyle(document.querySelector('.q-emis__idle')).animationName : null,
      splashGone: !document.querySelector('.q-splash'),
      cells: cells.length,
      painted,
      imgVisible: img ? Number(getComputedStyle(img).opacity) > 0.5 : false,
    };
  });
  verdict(r.idleAnim === 'none' || r.idle === false, '减动效下立绘无循环动画', `idle=${r.idle} animation=${r.idleAnim}`);
  verdict(r.painted === r.cells && r.cells > 0, '减动效下笔顺直接给完整静态字', `${r.painted}/${r.cells} 格有字`);
  verdict(r.imgVisible, '减动效下立绘可见');
  await ctx.close();
}

console.log(`\n合计失败 ${failed} 项`);
await browser.close();
process.exit(failed ? 1 : 0);
