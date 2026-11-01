/**
 * 内容页小陪伴 + /music/ hydration 修复 验收。
 *
 * 小陪伴的形态是随机的，所以测试里用 `Math.random` 的桩把它钉死，
 * 三条路径各自可复现：
 *   0    → corner（角落常驻）
 *   0.4  → peek（滚动探头）
 *   0.7  → end（文末出现）
 *
 * 用法：node scripts/check-companion.mjs
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/hjiap/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const BASE = 'http://127.0.0.1:4399';
const ARTICLE = '/blog/offline-python-quiz-app/';
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

/** 用固定的 Math.random 打开文章页 */
async function openWithRandom(value) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((v) => {
    /* 全程返回固定值 —— 不能只拦第一次：樱花粒子、motion 等都会先调用 Math.random，
       那样等到小陪伴掷形态时桩早就被消耗掉了（实测第一次就是这么翻车的）。
       副作用是这一页的粒子会全挤在同一个位置，测试里无所谓。 */
    Math.random = () => v;
  }, value);
  await page.goto(BASE + ARTICLE, { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(1600); // 等岛水合
  return { ctx, page };
}

const isOn = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.q-companion');
    return el ? el.classList.contains('is-on') : null;
  });
const getMode = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.q-companion');
    if (!el) return null;
    const m = el.className.match(/q-companion--(\w+)/);
    return m ? m[1] : null;
  });

/* ── corner ─────────────────────────────────────────────── */
{
  const { ctx, page } = await openWithRandom(0);
  const mode = await getMode(page);
  verdict(mode === 'corner', 'corner 形态生效', `mode=${mode}`);
  verdict((await isOn(page)) === true, 'corner 一进页面就在');
  await ctx.close();
}

/* ── peek ───────────────────────────────────────────────── */
{
  const { ctx, page } = await openWithRandom(0.4);
  const mode = await getMode(page);
  verdict(mode === 'peek', 'peek 形态生效', `mode=${mode}`);
  verdict((await isOn(page)) === false, 'peek 静止时不在');

  await page.evaluate(() => window.scrollBy(0, 400));
  await sleep(250);
  verdict((await isOn(page)) === true, 'peek 滚动时探头');

  await sleep(1800); // 超过 PEEK_HOLD_MS(1100)
  verdict((await isOn(page)) === false, 'peek 停下后缩回');
  await ctx.close();
}

/* ── end ────────────────────────────────────────────────── */
{
  const { ctx, page } = await openWithRandom(0.7);
  const mode = await getMode(page);
  verdict(mode === 'end', 'end 形态生效', `mode=${mode}`);
  verdict((await isOn(page)) === false, 'end 在文首不出现');

  await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, max);
  });
  await sleep(400);
  verdict((await isOn(page)) === true, 'end 读到文末才出现');
  await ctx.close();
}

/* ── 不与迷你播放器重叠 + 不产生横向滚动 ─────────────────── */
{
  const { ctx, page } = await openWithRandom(0);
  const geo = await page.evaluate(() => {
    const c = document.querySelector('.q-companion');
    const m = document.querySelector('[data-q-mini]');
    const cr = c ? c.getBoundingClientRect() : null;
    const mr = m ? m.getBoundingClientRect() : null;
    return {
      companion: cr ? { l: Math.round(cr.left), r: Math.round(cr.right), t: Math.round(cr.top), b: Math.round(cr.bottom) } : null,
      mini: mr ? { l: Math.round(mr.left), r: Math.round(mr.right), t: Math.round(mr.top), b: Math.round(mr.bottom) } : null,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    };
  });
  const overlap =
    geo.companion && geo.mini
      ? !(
          geo.companion.r < geo.mini.l ||
          geo.companion.l > geo.mini.r ||
          geo.companion.b < geo.mini.t ||
          geo.companion.t > geo.mini.b
        )
      : false;
  verdict(!overlap, '小陪伴不与迷你播放器重叠', `companion=${JSON.stringify(geo.companion)} mini=${JSON.stringify(geo.mini)}`);
  verdict(geo.scrollW <= geo.innerW + 1, '不产生横向滚动', `scrollWidth=${geo.scrollW} innerWidth=${geo.innerW}`);
  await ctx.close();
}

/* ── 窄屏隐藏 ───────────────────────────────────────────── */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluateOnNewDocument(() => {
    Math.random = () => 0;
  });
  await page.goto(BASE + ARTICLE, { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(1500);
  const disp = await page.evaluate(() => {
    const el = document.querySelector('.q-companion');
    return el ? getComputedStyle(el).display : 'missing';
  });
  verdict(disp === 'none', '窄屏不显示小陪伴', `display=${disp}`);
  await ctx.close();
}

/* ── /music/ hydration ────────────────────────────────────
   复现条件：localStorage 里已经有上次听的歌。修复前 MusicClient 的
   useState(getMusicState()) 会拿到被 restore() 改过的状态，与服务端 HTML 对不上。 */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // 先种一个「不是第 0 首」的状态
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.evaluate(() => {
    localStorage.setItem('qingwu:index', '3');
    localStorage.setItem('qingwu:volume', '0.42');
    localStorage.setItem('qingwu:mode', 'random');
  });
  const msgs = [];
  page.on('console', (m) => msgs.push(m.text()));
  await page.goto(BASE + '/music/', { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(2200);
  const hyd = msgs.filter((t) => /hydrat|didn't match|server rendered/i.test(t));
  verdict(hyd.length === 0, '/music/ 不再报 hydration mismatch', hyd.length ? hyd[0].slice(0, 120) : '无');
  await ctx.close();
}

console.log(`\n合计失败 ${failed} 项`);
await browser.close();
process.exit(failed ? 1 : 0);
