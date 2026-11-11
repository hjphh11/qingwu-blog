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
    /* 文案已按源码事实补全，内容区不该再有占位标记。
       ⚠️ 判据要限定在 .page-shell 内、且用占位文案真实用过的标记：
       直接扫 document.body.textContent 会命中 Layout 内联脚本里的注释
       （「图挂了也把占位层撤掉」），那是文字不是内容 —— 我第一版就这么误报了。 */
    placeholderLeft: /\[占位\]|—— 待补/.test(
      document.querySelector('.page-shell')?.textContent ?? '',
    ),
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
verdict(!proj.placeholderLeft, '文案已补全，页面上没有「占位/待补」残留');

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
    // 爱弥斯既有线上站也有仓库：应当是「主链接 + 源码仓库」两个入口。
    // ⚠️ 这两颗按钮会被脚本移到面板底部当页脚（不在滚动区里），所以要从 dialog 上找。
    links: Array.from(d.querySelectorAll('a[href^="http"]')).map((a) =>
      (a.getAttribute('href') || '').replace(/^https?:\/\//, ''),
    ),
    focusInside: d.contains(document.activeElement),
  };
});
verdict(sheetState.open, '点击卡片后 sheet 打开');
verdict(
  sheetState.dts === 4 && sheetState.dds === 4 && sheetState.textLen > 120,
  'sheet 里有「是什么/为什么做/最难/做成了什么」四段',
  `${sheetState.dts} 个 dt / ${sheetState.textLen} 字`,
);
verdict(sheetState.hasClose, '有关闭按钮');
verdict(
  sheetState.links.length === 2 && sheetState.links.some((h) => h.includes('emis.qingwu.ink')),
  'sheet 里有两个入口（线上站 + 源码仓库）',
  sheetState.links.join(' / '),
);

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

/* 反复打开不能累积页脚 —— 曾经每开一次就多堆一组按钮（用户截图里堆了五组）。
   根因：页脚是手动从滚动区搬到面板的，onClose 只清滚动区，清不到它。 */
for (let i = 0; i < 3; i++) {
  await page.evaluate((idx) => document.querySelectorAll('[data-proj-open]')[idx].click(), i % 2);
  await sleep(500);
  await page.keyboard.press('Escape');
  await sleep(350);
}
await page.evaluate(() => document.querySelectorAll('[data-proj-open]')[1].click());
await sleep(700);
const footer = await page.evaluate(() => {
  const d = document.querySelector('[data-proj-sheet]');
  return {
    groups: d.querySelectorAll('.q-sheet__links').length,
    buttons: d.querySelectorAll('.q-sheet__links a').length,
    href: d.querySelector('.q-sheet__links a')?.getAttribute('href') ?? '',
  };
});
verdict(footer.groups === 1, '反复开关后页脚只有一组', `实际 ${footer.groups} 组`);
verdict(
  footer.buttons === 1 && footer.href.includes('boot.qingwu.ink'),
  '最后打开的是清吾 API，页脚只剩它的入口',
  `${footer.buttons} 个：${footer.href}`,
);
await page.keyboard.press('Escape');
await sleep(300);

/* ── 导航下拉：文章 / 分享 合并成一组 ──────────────────────── */
console.log('\n【导航下拉】');
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(4500); // 首页有开屏，幕布会挡住鼠标事件 —— 必须等它收完

const nav = await page.evaluate(() => {
  const el = document.querySelector('header nav');
  if (!el) return null;
  const tops = Array.from(el.querySelectorAll('a')).filter((a) => !a.closest('[role="menu"]'));
  const parent = el.querySelector('a[aria-haspopup="true"]');
  return {
    labels: tops.map((a) => (a.textContent || '').trim()),
    hrefs: tops.map((a) => a.getAttribute('href')),
    hasParent: !!parent,
    parentHref: parent?.getAttribute('href') ?? null,
    expanded: parent?.getAttribute('aria-expanded') ?? null,
    // 「分享」不该再作为顶层项出现（它已经进了下拉）
    shareTopLevel: tops.some((a) => a.getAttribute('href') === '/share'),
  };
});
verdict(
  nav && nav.labels.length === 7,
  '顶层导航 7 项（分享并进「文章」，画市是独立一项）',
  nav ? nav.labels.join(' / ') : '未找到 nav',
);
verdict(!nav?.shareTopLevel, '「分享」不再是顶层项');
verdict(nav?.hasParent && nav.parentHref === '/blog', '「文章」是可点的父项，且指向 /blog', `href=${nav?.parentHref}`);
verdict(nav?.expanded === 'false', '初始未展开', `aria-expanded=${nav?.expanded}`);

// 悬停展开
const parentBox = await page.evaluate(() => {
  const a = document.querySelector('header nav a[aria-haspopup="true"]');
  const r = a.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, cx: r.x + r.width / 2 };
});
await page.mouse.move(parentBox.x, parentBox.y);
await sleep(450);
const dd = await page.evaluate(() => {
  const m = document.querySelector('[role="menu"]');
  const parent = document.querySelector('header nav a[aria-haspopup="true"]');
  if (!m) return { open: false };
  const pr = parent.getBoundingClientRect();
  const mr = m.getBoundingClientRect();
  return {
    open: true,
    expanded: parent.getAttribute('aria-expanded'),
    items: Array.from(m.querySelectorAll('a')).map((a) => ({
      label: (a.textContent || '').trim(),
      href: a.getAttribute('href'),
    })),
    // 居中对齐：面板中心与父项中心差 ≤ 2px（踩过 motion 覆盖 translate 的坑）
    centerDiff: Math.round(Math.abs((mr.x + mr.width / 2) - (pr.x + pr.width / 2))),
    below: mr.top >= pr.bottom - 4,
  };
});
verdict(dd.open && dd.expanded === 'true', '悬停展开，aria-expanded 跟着变', `expanded=${dd.expanded}`);
verdict(
  dd.items?.length === 2 && dd.items[0].href === '/blog' && dd.items[1].href === '/share',
  '下拉里是「文章列表 /blog」+「分享 /share」',
  (dd.items || []).map((i) => `${i.label}→${i.href}`).join(' · '),
);
verdict(dd.centerDiff !== undefined && dd.centerDiff <= 2, '面板居中在父项下方', `中心偏差 ${dd.centerDiff}px`);
verdict(dd.below, '面板在父项下方（不盖住导航条）');

// Esc 关闭
await page.keyboard.press('Escape');
await sleep(350);
const afterEsc = await page.evaluate(() => ({
  menu: !!document.querySelector('[role="menu"]'),
  expanded: document.querySelector('header nav a[aria-haspopup="true"]')?.getAttribute('aria-expanded'),
}));
verdict(!afterEsc.menu && afterEsc.expanded === 'false', 'Esc 能收起下拉', `expanded=${afterEsc.expanded}`);

// 键盘：Tab 到父项应展开（键盘用户不能只能靠鼠标）
await page.evaluate(() => document.body.focus());
await page.keyboard.press('Tab'); // 品牌
await page.keyboard.press('Tab'); // 首页
await page.keyboard.press('Tab'); // 文章
await sleep(400);
const kb = await page.evaluate(() => ({
  focused: (document.activeElement?.textContent || '').trim().slice(0, 6),
  expanded: document.activeElement?.getAttribute?.('aria-expanded'),
  menu: !!document.querySelector('[role="menu"]'),
}));
verdict(kb.expanded === 'true' && kb.menu, '键盘 Tab 到「文章」也会展开', `焦点=${kb.focused} expanded=${kb.expanded}`);

// 移动端：折叠菜单里两项都在（不做二级展开）
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1200);
await page.evaluate(() => document.querySelector('button[aria-label="打开菜单"]')?.click());
await sleep(500);
const mob = await page.evaluate(() => {
  const panel = document.querySelector('header > nav');
  const links = Array.from(panel?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href'));
  return { links, hasMenu: !!panel };
});
verdict(
  mob.links.includes('/blog') && mob.links.includes('/share'),
  '移动端折叠菜单里「文章/分享」都平铺可见',
  mob.links.join(' '),
);

/* ── 指示胶囊跟随当前项 ────────────────────────────────────
   踩过：为了让下拉有定位上下文，给每个导航项外面包了一层 <div class="relative">，
   于是 a.offsetLeft 全部变成 0 —— 胶囊永远停在第一项上（切到「音乐」时文字红了、
   粉底还留在「首页」），而 offsetWidth 不受影响，所以只错位置不错大小，肉眼很容易略过。
   这里同时卡「位置」与「宽度」，两者都要落在当前项上。 */
console.log('\n【导航胶囊】');
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(4600); // 首页开屏，幕布会挡住鼠标

const pillSnap = () =>
  page.evaluate(() => {
    const nav = document.querySelector('header nav');
    const pill = nav?.querySelector('div[aria-hidden="true"] > div');
    if (!nav || !pill) return null;
    const pr = pill.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    const items = Array.from(nav.querySelectorAll('a')).filter((a) => !a.closest('[role="menu"]'));
    // 用 computed color 判激活：className 里含 hover:text-crimson，字符串匹配会误命中
    const act = items.find((a) => getComputedStyle(a).color === 'rgb(194, 58, 85)');
    const ar = act?.getBoundingClientRect();
    return {
      path: location.pathname,
      activeLabel: act ? (act.textContent || '').trim().slice(0, 4) : null,
      pillLeft: Math.round(pr.left - nr.left),
      pillW: Math.round(pr.width),
      itemLeft: ar ? Math.round(ar.left - nr.left) : null,
      itemW: ar ? Math.round(ar.width) : null,
    };
  });

const basePill = await pillSnap();
verdict(
  !!basePill && basePill.pillW > 20 && Math.abs(basePill.pillLeft - basePill.itemLeft) <= 2,
  '首页：胶囊落在「首页」上且量得到宽度',
  basePill ? `pill ${basePill.pillLeft}/${basePill.pillW}` : '未取到',
);

for (const [label, href] of [
  ['音乐', '/music'],
  ['友链', '/links'],
  ['文章', '/blog'],
]) {
  await page.evaluate((l) => {
    const a = Array.from(document.querySelectorAll('header nav a')).find((x) =>
      (x.textContent || '').trim().startsWith(l),
    );
    a?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }, label);
  await sleep(1500);
  const snap = await pillSnap();
  verdict(
    !!snap &&
      // Astro 的静态路由带尾斜杠（/music/），比较前统一去掉
      snap.path.replace(/\/$/, '') === href &&
      snap.activeLabel === label &&
      Math.abs(snap.pillLeft - snap.itemLeft) <= 2 &&
      Math.abs(snap.pillW - snap.itemW) <= 2,
    `路由切到「${label}」后胶囊跟过去`,
    snap
      ? `path=${snap.path} 激活=${snap.activeLabel} pill ${snap.pillLeft}/${snap.pillW} vs 项 ${snap.itemLeft}/${snap.itemW}`
      : '未取到',
  );
}

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
