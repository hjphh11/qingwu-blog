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

/* ── 三栏结构（2026-11-01 改版）───────────────────────────
   左右定宽、中间自适应（180 / 1fr / 240），断点：≥1024 三栏、768–1024 两栏、
   <768 单栏。这里量的是「真的三列、宽度对、左栏该显就显该藏就藏」。 */
console.log('\n【三栏结构】');
const ctx3 = await browser.createBrowserContext();
const page = await ctx3.newPage();
for (const [w, expect, note] of [
  [1440, 3, '三栏'],
  [1024, 3, '三栏'],
  [820, 2, '两栏（左栏收起）'],
  [390, 1, '单栏'],
]) {
  await page.setViewport({ width: w, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(900);
  const cols = await page.evaluate(() => {
    const shell = document.querySelector('.page-shell');
    const left = document.querySelector('aside[aria-label="关于与分类"]');
    const mid = document.querySelector('.page-shell section');
    const right = document.querySelector('aside[aria-label="此刻"]');
    const tpl = getComputedStyle(shell).gridTemplateColumns.split(' ').filter(Boolean);
    const box = (e) => (e ? Math.round(e.getBoundingClientRect().width) : 0);
    return {
      n: tpl.length,
      tpl,
      leftW: box(left),
      midW: box(mid),
      rightW: box(right),
      leftShown: left ? getComputedStyle(left).display !== 'none' : false,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  verdict(cols.n === expect, `${w}px ${note}：${cols.n} 列`, cols.tpl.join(' / '));
  verdict(cols.overflow <= 0, `${w}px 无横向溢出`, `越界 ${cols.overflow}px`);
  if (expect === 3) {
    verdict(
      cols.leftShown && cols.leftW >= 160 && cols.leftW <= 200 && cols.rightW >= 220 && cols.rightW <= 260,
      `${w}px 两侧定宽合理（左 ~180 / 右 ~240）`,
      `左 ${cols.leftW} 中 ${cols.midW} 右 ${cols.rightW}`,
    );
    verdict(cols.midW > cols.leftW && cols.midW > cols.rightW, `${w}px 中间最宽（是内容主体）`, `中 ${cols.midW}`);
  }
  if (expect === 2) {
    verdict(!cols.leftShown, '820px 左栏已收起（不挤占中间）');
  }
}

/* 三栏最容易出的事：左栏没压在版心线上（品牌图标与左栏左缘差几十像素）。
   这条原来只靠 align-check，而它不覆盖首页 —— 三栏改版后必须单独补上。 */
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(4600);
const edges = await page.evaluate(() => {
  const brand = document.querySelector('header a[href="/"]');
  const left = document.querySelector('aside[aria-label="关于与分类"]');
  const midCard = document.querySelector('.page-shell section a[href^="/blog/"]');
  return {
    brand: brand ? Math.round(brand.getBoundingClientRect().left) : null,
    left: left ? Math.round(left.getBoundingClientRect().left) : null,
    midCard: midCard ? Math.round(midCard.getBoundingClientRect().left) : null,
  };
});
verdict(
  edges.brand !== null && edges.left !== null && Math.abs(edges.brand - edges.left) <= 1,
  '首页左栏左缘 == 品牌图标左缘',
  `品牌 ${edges.brand} / 左栏 ${edges.left}`,
);
verdict(
  edges.midCard !== null && edges.midCard > edges.left,
  '中间栏在左栏右侧（不是压上去）',
  `左栏 ${edges.left} / 文章卡 ${edges.midCard}`,
);


/* ── 左栏分类链接真的会筛选 ───────────────────────────────
   首页左栏是「按分类看」，点了要落到筛选后的列表，否则就是个假入口。 */
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1200);
const catLink = await page.evaluate(() => {
  const a = document.querySelector('aside[aria-label="关于与分类"] nav a[href*="category="]');
  return a ? { href: a.getAttribute('href'), label: a.textContent.trim() } : null;
});
verdict(!!catLink, '左栏有带 ?category= 的分类入口', catLink ? `${catLink.label} → ${catLink.href}` : '未找到');

if (catLink) {
  const cat = new URL(catLink.href, BASE).searchParams.get('category');
  await page.goto(`${BASE}${catLink.href}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(900);
  const filtered = await page.evaluate(() => {
    const btn = document.querySelector(`#post-filters button[data-filter="${new URLSearchParams(location.search).get('category')}"]`);
    const cards = Array.from(document.querySelectorAll('#post-list [data-category]'));
    const visible = cards.filter((c) => getComputedStyle(c).display !== 'none');
    return {
      pressed: btn?.getAttribute('aria-pressed'),
      active: btn?.classList.contains('is-active'),
      total: cards.length,
      shown: visible.length,
      allMatch: visible.every((c) => c.getAttribute('data-category') === new URLSearchParams(location.search).get('category')),
    };
  });
  verdict(
    filtered.pressed === 'true' && filtered.active,
    '带 ?category= 进来时该分类按钮是选中态',
    `aria-pressed=${filtered.pressed} is-active=${filtered.active}`,
  );
  verdict(
    filtered.shown > 0 && filtered.shown < filtered.total && filtered.allMatch,
    `列表真的只剩「${cat}」分类`,
    `${filtered.shown}/${filtered.total} 张可见`,
  );
}

await ctx3.close();

console.log(`\n合计失败 ${failed} 项`);
await browser.close();
process.exit(failed ? 1 : 0);
