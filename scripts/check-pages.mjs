/**
 * 第 9 条验收 —— `npm run check:pages`
 *
 * 覆盖 §9.5 里能机器验的部分：
 *   · 友链卡片可读（申请页路由与表单**未改动**，这里只确认入口在、卡片可读）
 *   · 关于页 sticky 正常、4 区块齐全、信息未丢
 *   · 项目卡错位、倾斜 ≤ ±8°、箔膜跟随指针、共享光扫只有一层、展开 sheet 正常
 *   · 404 超大衬线 404 + 手写「?」
 *   · 导航新增「项目」后三档仍无横向溢出
 *
 * 不验的：真实提交到 D1（需要线上环境与 Turnstile）、项目文案（仍是占位）。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/hjiap/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const BASE = 'http://127.0.0.1:4399';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function verdict(ok, name, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${detail ? `  —— ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? `  —— ${detail}` : ''}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=127.0.0.1;localhost'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

/* ── 关于页 ────────────────────────────────────────────── */
console.log('\n【关于页】');
await page.goto(`${BASE}/about/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(900);

const about = await page.evaluate(() => {
  const ids = ['about-01', 'about-02', 'about-03', 'about-04'];
  const blocks = ids.map((id) => {
    const h = document.getElementById(id);
    if (!h) return { id, ok: false };
    const sec = h.closest('section');
    return {
      id,
      ok: true,
      // 区块里至少要有正文，否则是空壳。
      // ⚠️ 04 联系块是展开式组件（client:load），服务端只渲染一个触发器，
      //    所以对它的判据是「有可点的按钮」，不是字数。
      textLen: (sec?.textContent ?? '').trim().length,
      buttons: sec ? sec.querySelectorAll('button, a').length : 0,
      num: (sec?.querySelector('[aria-hidden="true"]')?.textContent ?? '').trim(),
    };
  });
  const aside = document.querySelector('aside');
  const pic = document.querySelector('aside img');
  return {
    blocks,
    sticky: aside ? getComputedStyle(aside).position : null,
    portrait: pic ? { w: pic.naturalWidth, h: pic.naturalHeight } : null,
    // 信息条目：dl 里的 dt 数
    facts: document.querySelectorAll('dl dt').length,
    // 老内容有没有丢
    hasWhyName: (document.body.textContent || '').includes('清吾'),
  };
});

for (const b of about.blocks) {
  // 联系块例外：内容藏在展开面板里，只要求有触发器
  const enough = b.id === 'about-04' ? b.buttons > 0 : b.textLen > 40;
  verdict(b.ok && enough, `区块 ${b.id} 存在且有内容`, b.ok ? `${b.textLen} 字 / ${b.buttons} 个触发器` : '缺失');
}
verdict(
  about.blocks.map((b) => b.num).join(',') === '01,02,03,04',
  '四个区块按 01/02/03/04 编号',
  about.blocks.map((b) => b.num).join(' / '),
);
verdict(about.sticky === 'sticky', '左栏立绘是 sticky（lg 断点）', `position=${about.sticky}`);
verdict(
  about.portrait && about.portrait.w > 0,
  '立绘真的加载了（不是空白占位）',
  about.portrait ? `${about.portrait.w}×${about.portrait.h}` : '无 img',
);
verdict(about.facts >= 4, '信息条目没丢', `${about.facts} 条 dt`);

/* ── 项目页 ────────────────────────────────────────────── */
console.log('\n【项目页】');
await page.goto(`${BASE}/projects/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(900);

const proj = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[data-proj-card]'));
  const inner = cards[0]?.querySelector('.q-proj__inner');
  const sweep = document.querySelectorAll('.q-proj-sweep');
  const r0 = inner?.getBoundingClientRect();
  const r1 = cards[1]?.querySelector('.q-proj__inner')?.getBoundingClientRect();
  return {
    count: cards.length,
    top0: r0 ? Math.round(r0.top) : null,
    top1: r1 ? Math.round(r1.top) : null,
    left0: r0 ? Math.round(r0.left) : null,
    left1: r1 ? Math.round(r1.left) : null,
    sweeps: sweep.length,
    sweepAnim: sweep[0] ? getComputedStyle(sweep[0]).animationName : null,
    foilOpacity: getComputedStyle(cards[0].querySelector('.q-proj__foil')).opacity,
    placeholderNote: (document.body.textContent || '').includes('占位'),
  };
});
verdict(proj.count === 2, '两张项目卡', `实际 ${proj.count} 张`);
verdict(
  proj.top1 !== null && proj.top0 !== null && proj.top1 > proj.top0 + 20,
  '两卡错位排列（第二张下沉，不是齐平网格）',
  `top ${proj.top0} → ${proj.top1}（差 ${proj.top1 - proj.top0}px）`,
);
verdict(
  proj.left1 !== null && proj.left0 !== null && proj.left1 > proj.left0,
  '两卡并排（左右分列）',
  `left ${proj.left0} → ${proj.left1}`,
);
verdict(proj.sweeps === 1, '共享光扫只有一层（不是每卡一个）', `${proj.sweeps} 层`);
verdict(proj.sweepAnim === 'q-proj-sweep', '光扫动画在跑', `animation-name=${proj.sweepAnim}`);
verdict(proj.foilOpacity === '0', '未悬停时箔膜不显形', `opacity=${proj.foilOpacity}`);
verdict(proj.placeholderNote, '页面明确标注了文案仍是占位');

// 倾斜 ±8° + 箔膜跟随：把指针移到卡片右上方，再移到左下方，看角度与位移是否跟着变
const box = await page.evaluate(() => {
  const r = document.querySelector('[data-proj-card] .q-proj__inner').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const readTilt = () =>
  page.evaluate(() => {
    const inner = document.querySelector('[data-proj-card] .q-proj__inner');
    const cs = getComputedStyle(inner);
    const m = new DOMMatrixReadOnly(cs.transform);
    const rad2deg = (v) => (v * 180) / Math.PI;
    return {
      ry: Number(rad2deg(Math.atan2(-m.m13, m.m11)).toFixed(2)),
      rx: Number(rad2deg(Math.atan2(m.m23, m.m22)).toFixed(2)),
      mx: inner.style.getPropertyValue('--mx'),
      my: inner.style.getPropertyValue('--my'),
      foil: Number(getComputedStyle(inner.querySelector('.q-proj__foil')).opacity),
    };
  });

await page.mouse.move(box.x + box.w * 0.9, box.y + box.h * 0.15);
await sleep(250);
const tiltA = await readTilt();
await page.mouse.move(box.x + box.w * 0.1, box.y + box.h * 0.9);
await sleep(250);
const tiltB = await readTilt();

verdict(
  tiltA.ry > 2 && tiltB.ry < -2,
  '水平位移真的改变 rotateY（方向也跟手）',
  `右 ${tiltA.ry}° / 左 ${tiltB.ry}°`,
);
verdict(
  Math.abs(tiltA.ry) <= 8.5 && Math.abs(tiltB.ry) <= 8.5 && Math.abs(tiltA.rx) <= 8.5,
  '倾斜不超过 ±8°',
  `ry=${tiltA.ry},${tiltB.ry} rx=${tiltA.rx}`,
);
verdict(
  tiltA.foil > 0.5 && tiltB.foil > 0.5,
  '悬停时箔膜显形',
  `opacity=${tiltA.foil} / ${tiltB.foil}`,
);
verdict(
  tiltA.mx !== tiltB.mx || tiltA.my !== tiltB.my,
  '箔膜跟着指针走（--mx/--my 在变）',
  `${tiltA.mx},${tiltA.my} → ${tiltB.mx},${tiltB.my}`,
);

// 展开 sheet
await page.evaluate(() => {
  document.querySelector('[data-proj-open]').click();
});
await sleep(700);
const sheetState = await page.evaluate(() => {
  const d = document.querySelector('[data-proj-sheet]');
  const body = d.querySelector('[data-proj-sheet-body]');
  return {
    open: d.open,
    dts: body.querySelectorAll('dt').length,
    dds: body.querySelectorAll('dd').length,
    textLen: (body.textContent || '').trim().length,
    hasClose: !!d.querySelector('[data-proj-close]'),
    focusInside: d.contains(document.activeElement),
  };
});
verdict(sheetState.open, '点击卡片后 sheet 打开');
verdict(
  sheetState.dts === 3 && sheetState.dds === 3 && sheetState.textLen > 20,
  'sheet 里有「是什么/为什么/最难」三段',
  `${sheetState.dts} 个 dt / ${sheetState.textLen} 字`,
);
verdict(sheetState.hasClose, '有关闭按钮');

await page.keyboard.press('Escape');
await sleep(400);
const closed = await page.evaluate(() => {
  const d = document.querySelector('[data-proj-sheet]');
  return {
    open: d.open,
    focusOnCard: document.activeElement?.hasAttribute?.('data-proj-open') ?? false,
  };
});
verdict(!closed.open, 'Esc 能关掉 sheet');
verdict(closed.focusOnCard, '关闭后焦点回到原来那张卡（键盘不掉队）');

/* ── 404 ──────────────────────────────────────────────── */
console.log('\n【404】');
await page.goto(`${BASE}/404.html`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(600);
const notFound = await page.evaluate(() => {
  const ps = Array.from(document.querySelectorAll('p'));
  const big = ps.find((p) => (p.textContent || '').trim() === '404');
  const q = document.querySelector('.q-lost__q');
  const cs = big ? getComputedStyle(big) : null;
  return {
    size: cs ? parseFloat(cs.fontSize) : 0,
    family: cs ? cs.fontFamily : '',
    q: q ? (q.textContent || '').trim() : null,
    qFamily: q ? getComputedStyle(q).fontFamily : '',
  };
});
verdict(notFound.size >= 80, '404 是超大字号', `${Math.round(notFound.size)}px`);
verdict(/ZCOOL/.test(notFound.family), '404 用衬线标题体（不是手写体）', notFound.family.split(',')[0]);
verdict(notFound.q === '?', '头顶手写「?」还在', `「${notFound.q}」`);
verdict(/Ma Shan Zheng/.test(notFound.qFamily), '「?」是手写体（与 404 形成反差）', notFound.qFamily.split(',')[0]);

/* ── 导航与三档溢出 ────────────────────────────────────── */
console.log('\n【导航与版式】');
for (const [w, h] of [[1440, 900], [1024, 800], [390, 844]]) {
  await page.setViewport({ width: w, height: h });
  await page.goto(`${BASE}/projects/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(500);
  const r = await page.evaluate(() => ({
    navHasProjects: !!document.querySelector('nav a[href="/projects"]'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  verdict(r.navHasProjects, `${w}px 导航里有「项目」`);
  verdict(r.overflow <= 1, `${w}px 无横向溢出`, `scrollWidth-innerWidth=${r.overflow}`);
}

/* ── 友链（只验入口与可读性，表单未改） ────────────────── */
console.log('\n【友链】');
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/links/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(600);
const links = await page.evaluate(() => {
  // 友链卡本身就是 <a class="glass-card" href="http…">；
  // 用 a[href^="http"] 会连页脚/GitHub 图标一起数进来，那是我判据写错了。
  const cards = Array.from(document.querySelectorAll('a.glass-card[href^="http"]'));
  const withName = cards.filter((a) => (a.textContent || '').trim().length > 8);
  return {
    cards: cards.length,
    readable: withName.length,
    applyEntry: !!document.querySelector('a[href="/links/apply"]'),
  };
});
verdict(links.cards > 0 && links.readable === links.cards, '友链卡片都可读（有名字+简介）', `${links.readable}/${links.cards}`);
verdict(links.applyEntry, '申请入口在（表单与路由按 §9.1 未动）');

const severe = errors.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e));
verdict(severe.length === 0, '无 JavaScript 运行时错误', severe.slice(0, 3).join(' | ') || '（无）');

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
