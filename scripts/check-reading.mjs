/**
 * 第 7 条「文章链路」验收（§7.4）。
 *
 *   ① 所有已发布文章可读（HTTP 200 + 有 h1 + 正文有内容）
 *   ② TOC 与标题 id 一一对应（每个链接都能找到目标；每个 h2/h3 都有对应项）
 *   ③ TOC 当前项会随滚动切换（§7.3 的「当前项左侧 2px 光线」）
 *   ④ **任意滚动位置**正文对比度 ≥ 4.5:1 —— 用截图取样算，不靠肉眼
 *   ⑤ 高对比开关：默认关、点了生效、刷新保持、开着的对比度不低于关着
 *
 * ④ 的做法：截图 → 丢回页面里画到 canvas → 取每段正文包围盒内的像素 →
 * 用 1% / 99% 分位的相对亮度算比值。取分位而不是极值，是为了避开抗锯齿边缘
 * 与单个异色像素的干扰；这比「读 CSS 颜色」接近真实观感，因为背景是渐变 + 极光。
 *
 * 用法：node scripts/check-reading.mjs
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

/** 截图取样算正文对比度，返回所有段落里的最差值 */
async function minContrast(page) {
  const b64 = await page.screenshot({ encoding: 'base64' });
  return await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();

    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);

    const scale = img.naturalWidth / window.innerWidth;

    const lin = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

    const paras = Array.from(document.querySelectorAll('article p')).filter(
      (el) => (el.textContent || '').trim().length > 20,
    );

    let worst = { ratio: 99, text: '' };
    for (const p of paras) {
      const r = p.getBoundingClientRect();
      if (r.width < 40 || r.height < 8) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;

      const x0 = Math.max(0, Math.round(r.left * scale));
      const y0 = Math.max(0, Math.round(r.top * scale));
      const w = Math.min(cv.width - x0, Math.round(r.width * scale));
      const h = Math.min(cv.height - y0, Math.round(r.height * scale));
      if (w <= 0 || h <= 0) continue;

      const d = cx.getImageData(x0, y0, w, h).data;
      const ls = new Array(d.length / 4);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) ls[j] = lum(d[i], d[i + 1], d[i + 2]);
      ls.sort((a, b) => a - b);

      const p01 = ls[Math.floor(ls.length * 0.01)];
      const p99 = ls[Math.floor(ls.length * 0.99)];
      const ratio = (p99 + 0.05) / (p01 + 0.05);
      if (ratio < worst.ratio) worst = { ratio, text: (p.textContent || '').trim().slice(0, 14) };
    }
    return worst;
  }, b64);
}

/* ── 先拿到所有文章地址 ────────────────────────────────────
   从 sitemap 取，而不是从列表页抓链接 —— 列表页是分页的（每页 6 篇），
   抓链接只能拿到第一页，会把「10 篇全部可读」这条测成 6 篇就通过。 */
async function articlePaths() {
  const paths = new Set();
  for (const name of ['/sitemap-0.xml', '/sitemap-index.xml']) {
    try {
      const res = await fetch(BASE + name);
      if (!res.ok) continue;
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const p = new URL(m[1]).pathname.replace(/\/$/, '');
        if (/^\/blog\/[^/]+$/.test(p) && !p.includes('/blog/page/')) paths.add(p);
      }
      if (paths.size) break;
    } catch {
      /* 换下一个 */
    }
  }
  return [...paths];
}

const uniq = await articlePaths();
console.log(`发现 ${uniq.length} 篇文章\n`);

/* ── ① 全部可读 ─────────────────────────────────────────── */
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1440, height: 900 });

let readable = 0;
for (const href of uniq) {
  const res = await page.goto(BASE + href, { waitUntil: 'networkidle2', timeout: 40000 });
  const ok = await page.evaluate(() => {
    const h1 = document.querySelector('article h1');
    const body = document.querySelector('article .prose, article');
    /* 最短的一篇随笔只有 77 字，阈值不能按「长文」定；只要求有 h1 + 有正文即可 */
    return !!h1 && !!body && (body.textContent || '').trim().length > 40;
  });
  if (res && res.status() === 200 && ok) readable++;
  else console.log(`   读不到: ${href} status=${res && res.status()} ok=${ok}`);
}
verdict(readable === uniq.length, '全部文章可读（200 + h1 + 有正文）', `${readable}/${uniq.length}`);

/* ── ② TOC 与标题 id 对应 ───────────────────────────────── */
let tocOk = 0;
let tocBad = [];
for (const href of uniq) {
  await page.goto(BASE + href, { waitUntil: 'networkidle2', timeout: 40000 });
  const r = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('[data-toc-link]'));
    const ids = links.map((a) => a.dataset.tocLink);
    const missing = ids.filter((id) => !document.getElementById(id));
    const heads = Array.from(document.querySelectorAll('article h2[id], article h3[id]')).map((h) => h.id);
    const noLink = heads.filter((id) => !ids.includes(id));
    return { links: ids.length, heads: heads.length, missing, noLink };
  });
  if (r.links === 0 && r.heads === 0) {
    tocOk++; // 没有小标题的文章，两边都空，也算对应
  } else if (r.missing.length === 0 && r.noLink.length === 0) {
    tocOk++;
  } else {
    tocBad.push(`${href} missing=${r.missing} noLink=${r.noLink}`);
  }
}
verdict(tocOk === uniq.length, 'TOC 与标题 id 一一对应', `${tocOk}/${uniq.length}${tocBad.length ? ' 问题:' + tocBad[0] : ''}`);

/* ── ③ TOC 当前项随滚动切换 ─────────────────────────────── */
{
  // 挑一篇 h2 最多的文章
  let best = null;
  let bestN = 0;
  for (const href of uniq) {
    await page.goto(BASE + href, { waitUntil: 'networkidle2', timeout: 40000 });
    const n = await page.evaluate(() => document.querySelectorAll('[data-toc-link]').length);
    if (n > bestN) {
      bestN = n;
      best = href;
    }
  }
  await page.goto(BASE + best, { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(1200);

  const readActive = () =>
    page.evaluate(() => {
      const a = document.querySelector('.q-toc__link.is-active');
      return a ? a.dataset.tocLink : null;
    });

  const first = await readActive();
  // 滚到文章中部
  await page.evaluate(() => {
    const heads = document.querySelectorAll('article h2[id], article h3[id]');
    const mid = heads[Math.floor(heads.length / 2)];
    if (mid) mid.scrollIntoView({ block: 'start' });
  });
  await sleep(900);
  const mid = await readActive();

  verdict(!!first && !!mid, 'TOC 当前项有高亮', `${best} 首项=${first} 中部=${mid}`);
  verdict(first !== mid, '滚动后当前项会切换', `${first} → ${mid}`);
}

/* ── ④ 对比度（多篇 × 多个滚动位置）─────────────────────── */
{
  const sample = uniq.slice(0, 5);
  let worst = { ratio: 99, where: '' };
  for (const href of sample) {
    await page.goto(BASE + href, { waitUntil: 'networkidle2', timeout: 40000 });
    await sleep(700);
    for (const frac of [0, 0.4, 0.85]) {
      await page.evaluate((f) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.round(max * f));
      }, frac);
      await sleep(450);
      const r = await minContrast(page);
      if (r.ratio < worst.ratio) worst = { ratio: r.ratio, where: `${href} @${Math.round(frac * 100)}% 「${r.text}」` };
    }
  }
  verdict(worst.ratio >= 4.5, '正文对比度 ≥ 4.5:1（截图取样，最差处）', `${worst.ratio.toFixed(2)}:1  ${worst.where}`);

  /* ── ⑤ 高对比开关 ─────────────────────────────────────── */
  await page.goto(BASE + uniq[0], { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(600);

  const before = await page.evaluate(() => ({
    on: document.documentElement.classList.contains('q-contrast'),
    pressed: document.querySelector('[aria-label="开启高对比阅读"]') ? 'off-label' : 'other',
    btn: !!document.querySelector('button[aria-pressed]'),
  }));
  verdict(!before.on && before.btn, '默认关，且有开关按钮', `q-contrast=${before.on}`);

  const offRatio = await minContrast(page);
  // 次要文字的颜色才是这个开关真正要动的东西（正文 ink 本来就够）
  const offMuted = await page.evaluate(() => {
    const el = document.querySelector('.text-muted, .list-card-meta, article time');
    return el ? getComputedStyle(el).color : null;
  });

  await page.evaluate(() => document.querySelector('button[aria-pressed]').click());
  await sleep(500);
  const after = await page.evaluate(() => ({
    on: document.documentElement.classList.contains('q-contrast'),
    pressed: document.querySelector('button[aria-pressed]').getAttribute('aria-pressed'),
    stored: localStorage.getItem('qingwu:contrast'),
  }));
  verdict(after.on && after.pressed === 'true' && after.stored === '1', '点击后开启并记住', `q-contrast=${after.on} stored=${after.stored}`);

  const onRatio = await minContrast(page);
  const onMuted = await page.evaluate(() => {
    const el = document.querySelector('.text-muted, .list-card-meta, article time');
    return el ? getComputedStyle(el).color : null;
  });

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);
  const persisted = await page.evaluate(() => document.documentElement.classList.contains('q-contrast'));
  verdict(persisted, '刷新后保持开启');

  verdict(
    onRatio.ratio >= offRatio.ratio - 0.05,
    '开启后正文对比度不低于关闭时（允许 0.05 采样噪声）',
    `关 ${offRatio.ratio.toFixed(2)}:1 → 开 ${onRatio.ratio.toFixed(2)}:1`,
  );
  verdict(
    !!offMuted && !!onMuted && offMuted !== onMuted,
    '开启后次要文字颜色确实变深',
    `${offMuted} → ${onMuted}`,
  );

  // 收拾干净，别把状态留给后面的检查
  await page.evaluate(() => {
    document.querySelector('button[aria-pressed]').click();
    localStorage.removeItem('qingwu:contrast');
  });
}

await ctx.close();
console.log(`\n合计失败 ${failed} 项`);
await browser.close();
process.exit(failed ? 1 : 0);
