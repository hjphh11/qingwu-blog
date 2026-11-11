/**
 * 画市（/gallery）验收：整屏可拖图片墙。
 *
 * 逐条对应它承诺的几件事：
 *   ① 瓦片铺满：任意方向拖多远都不露底（图案平铺 + 位移取模）
 *   ② 松手有惯性，但会停下来（不是无限滑，也不是一松就死）
 *   ③ 点图看大图：拖拽不算点击；大图是真的 /images/gallery/<id>.webp
 *   ④ 灯箱在导航之上（层叠上下文踩过：放 .q-wall 里会被 z-0 关住）
 *   ⑤ 整页不可滚动、页脚按 bare 关掉
 *   ⑥ 无 JS 运行时错误
 *
 * 用法：先起静态产物 `dist/client` 的 4399 服务，再 `node scripts/check-gallery.mjs`
 */

import puppeteer from 'file:///C:/Users/hjiap/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:4399';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const verdict = (ok, label, detail = '') => {
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
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
await page.goto(`${BASE}/gallery/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2200);

/** 读一帧状态：节点数、图案层 transform、所有瓦片的联合包围盒 */
const read = () =>
  page.evaluate(() => {
    const layer = document.querySelector('.q-wall__layer');
    const rects = [...document.querySelectorAll('.q-wall__tile')].map((t) =>
      t.getBoundingClientRect(),
    );
    const box = (k) =>
      rects.length
        ? Math.round(
            k === 'l'
              ? Math.min(...rects.map((r) => r.left))
              : k === 't'
                ? Math.min(...rects.map((r) => r.top))
                : k === 'r'
                  ? Math.max(...rects.map((r) => r.right))
                  : Math.max(...rects.map((r) => r.bottom)),
          )
        : 0;
    return {
      n: rects.length,
      tf: layer ? getComputedStyle(layer).transform : null,
      l: box('l'),
      t: box('t'),
      r: box('r'),
      b: box('b'),
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollH: document.documentElement.scrollHeight,
      locked: document.documentElement.classList.contains('q-wall-page'),
      footer: !!document.querySelector('footer'),
    };
  });

/** 四面都盖住视口 */
const covered = (s) => s.l <= 0 && s.t <= 0 && s.r >= s.vw && s.b >= s.vh;

const s0 = await read();
verdict(s0.n > 40, '瓦片铺开了', `${s0.n} 个节点`);
verdict(!!s0.tf, '图案层由 JS 写 transform', s0.tf);
verdict(covered(s0), '首帧四面盖住视口', `L${s0.l} T${s0.t} R${s0.r} B${s0.b}`);
verdict(s0.scrollH <= s0.vh + 1, '页面没有可滚动高度', `scrollHeight=${s0.scrollH}`);
verdict(s0.locked, 'html 挂上 q-wall-page（锁滚动/禁回弹）');
verdict(!s0.footer, '页脚按 Layout bare 关掉');

/* ── ① 拖着走：横竖都拖，中途与松手后都不许露边 ─────────── */
await page.mouse.move(720, 450);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(720 + i * 40, 450 + i * 12);
  await sleep(16);
}
const midDrag = await read();
verdict(covered(midDrag), '拖到一半仍有图', `L${midDrag.l} R${midDrag.r}`);

// 继续拖过一整个周期（1440 下周期约 1490px）：图案要能无缝接上
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(720 + 320 + i * 110, 450 + 96);
  await sleep(16);
}
const cross = await read();
verdict(covered(cross), '拖过整整一个周期也没露边（图案接缝）', `L${cross.l} R${cross.r}`);
await page.mouse.up();
await sleep(1200);
const settled = await read();
verdict(covered(settled), '松手（惯性跑完）后仍有图', `L${settled.l} R${settled.r}`);

/* ── ② 惯性：甩一下，动几帧，然后停 ────────────────────── */
await page.mouse.move(700, 450);
await page.mouse.down();
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(700 - i * 70, 450);
  await sleep(8);
}
await page.mouse.up();
const frames = [];
for (let i = 0; i < 6; i++) {
  await sleep(120);
  frames.push((await read()).tf);
}
verdict(new Set(frames).size >= 3, '松手后还在动（有惯性）', `${new Set(frames).size} 个不同帧`);
await sleep(1600);
const still1 = (await read()).tf;
await sleep(400);
const still2 = (await read()).tf;
verdict(still1 === still2, '最后停住了（不会一直滑）', still1);

/* ── ③ 点击看大图 ─────────────────────────────────────── */
/* 别直接点视口中心：瓦片之间有 10px 缝，拖完之后中心很可能正好落在缝里，
   那样点出来的是空档（elementFromPoint 拿不到瓦片），会误判成「点击坏了」。
   取离视口中心最近的那张图，点它的中心。 */
const spot = await page.evaluate(() => {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  let best = null;
  for (const el of document.querySelectorAll('.q-wall__tile')) {
    const r = el.getBoundingClientRect();
    if (r.width < 10) continue;
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (!best || d < best.d) best = { d, x, y };
  }
  return best;
});
verdict(!!spot, '找得到一张可点的瓦片', spot ? `(${spot.x}, ${spot.y})` : '无');
await page.mouse.click(spot.x, spot.y);
await sleep(600);
const opened = await page.evaluate(() => {
  const v = document.querySelector('.q-wall-view');
  const img = v?.querySelector('.q-wall-view__img');
  return {
    open: v?.classList.contains('is-open'),
    vis: v ? getComputedStyle(v).visibility : null,
    src: img?.getAttribute('src') ?? '',
    nat: img?.naturalWidth ?? 0,
    count: v?.querySelector('.q-wall-view__count')?.textContent?.trim() ?? '',
  };
});
verdict(opened.open && opened.vis === 'visible', '点图打开看大图', `${opened.vis} ${opened.count}`);
verdict(
  /^https:\/\/img\.qingwu\.ink\/gallery\/[a-f0-9]{10}\.webp$/.test(opened.src),
  '大图来自 R2（不是瓦片）',
  opened.src,
);
verdict(opened.nat > 0, '大图真的解码出来了', `naturalWidth=${opened.nat}`);

/* ④ 灯箱必须盖住导航（.q-wall 的 z-0 会把子元素关在层叠上下文里，踩过一次） */
const coverNav = await page.evaluate(() => {
  const nav = document.querySelector('header');
  const view = document.querySelector('.q-wall-view');
  if (!nav || !view) return null;
  const r = nav.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { covered: !!top && (view.contains(top) || top === view), tag: top?.tagName ?? '' };
});
verdict(coverNav?.covered, '灯箱盖在导航之上（不被 z-50 的导航压住）', coverNav?.tag);

/* 键盘：← → 翻页，ESC 关闭 */
const countBefore = opened.count;
await page.keyboard.press('ArrowRight');
await sleep(400);
const countAfter = await page.evaluate(
  () => document.querySelector('.q-wall-view__count')?.textContent?.trim() ?? '',
);
verdict(countBefore !== countAfter, '方向键能翻下一张', `${countBefore} → ${countAfter}`);

await page.keyboard.press('Escape');
await sleep(500);
const closed = await page.evaluate(() => {
  const v = document.querySelector('.q-wall-view');
  return { open: v.classList.contains('is-open'), vis: getComputedStyle(v).visibility };
});
verdict(!closed.open && closed.vis === 'hidden', 'ESC 关掉，且关掉后不再挡住墙', closed.vis);

/* ── ⑤ 关掉之后还能继续拖 ─────────────────────────────── */
await page.mouse.move(720, 450);
await page.mouse.down();
await page.mouse.move(600, 400);
await sleep(60);
await page.mouse.up();
await sleep(500);
const afterClose = await read();
verdict(covered(afterClose), '关掉灯箱后墙还能拖', `L${afterClose.l} R${afterClose.r}`);

/* ── ⑥ 减动效：拖拽保留（是用户主动发起的），松手不许再自己滑 ── */
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/gallery/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1800);
await page.mouse.move(700, 450);
await page.mouse.down();
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(700 - i * 70, 450);
  await sleep(8);
}
await page.mouse.up();
await sleep(120);
const calmA = (await read()).tf;
await sleep(400);
const calmB = (await read()).tf;
verdict(calmA === calmB, '减动效下松手即停（不留惯性）', `${calmA} → ${calmB}`);
await page.emulateMediaFeatures([]);

/* ── ⑦ 手机：底栏会吃掉底部两个浮层，提示要挪到导航下面 ── */
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/gallery/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1800);
const mobile = await page.evaluate(() => {
  const hint = document.querySelector('.q-wall__hint');
  const credit = document.querySelector('.q-wall__credit');
  const player = document.querySelector('.pointer-events-none.fixed.inset-0.z-50')?.firstElementChild;
  const h = hint ? hint.getBoundingClientRect() : null;
  const c = credit ? credit.getBoundingClientRect() : null;
  const pr = player ? player.getBoundingClientRect() : null;
  return {
    hTop: h ? Math.round(h.top) : null,
    cBottom: c ? Math.round(c.bottom) : null,
    playerTop: pr ? Math.round(pr.top) : null,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});
verdict(mobile.overflow <= 0, '390 无横向溢出', `越界 ${mobile.overflow}px`);
verdict(
  mobile.hTop !== null && mobile.hTop < 160,
  '390 提示挪到了顶部（不被底部播放器压住）',
  `top=${mobile.hTop}`,
);
verdict(
  mobile.playerTop === null || (mobile.cBottom !== null && mobile.cBottom <= mobile.playerTop),
  '390 出处让开了底部播放器',
  `credit bottom=${mobile.cBottom} / player top=${mobile.playerTop}`,
);

verdict(errors.length === 0, '无 JS 运行时错误', errors.join(' | ') || '（无）');

/* ── ⑦ 取图与降级（图在 R2，索引同源分片）─────────────────
   ① 索引 404：不能白屏，要退回构建期那 60 张（sample）
   ② R2 整片连不上：要出「图源没连上 · 重试」，而不是一面空墙 */
{
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1200, height: 800 });
  await p2.setRequestInterception(true);
  p2.on('request', (r) => (r.url().includes('/gallery/data/') ? r.abort() : r.continue()));
  await p2.goto(`${BASE}/gallery/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  const fallback = await p2.evaluate(() => ({
    tiles: document.querySelectorAll('.q-wall__tile').length,
    loading: !!document.querySelector('.q-wall__loading'),
  }));
  verdict(fallback.tiles > 0, '索引取不到时用构建期样本兜底（不白屏）', `${fallback.tiles} 个瓦片`);
  await p2.close();

  const p3 = await browser.newPage();
  await p3.setViewport({ width: 1200, height: 800 });
  await p3.setRequestInterception(true);
  p3.on('request', (r) => (r.url().includes('img.qingwu.ink') ? r.abort() : r.continue()));
  await p3.goto(`${BASE}/gallery/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  const skel = await p3.evaluate(() => ({
    failed: document.querySelectorAll('.q-wall__tile.is-failed').length,
    ready: document.querySelectorAll('.q-wall__tile.is-ready').length,
  }));
  verdict(skel.ready === 0, '图到之前是骨架态（没有半张图）', `ready=${skel.ready}`);
  await sleep(3200);
  const broken = await p3.evaluate(() => ({
    retry: !!document.querySelector('.q-wall__retry'),
    hintGone: !!document.querySelector('.q-wall__hint.is-gone'),
  }));
  verdict(broken.retry && broken.hintGone, '图源整体连不上时给「重试」而不是空墙');
  await p3.close();
}

console.log(`\n合计失败 ${failed} 项`);
await browser.close();
process.exit(failed ? 1 : 0);
