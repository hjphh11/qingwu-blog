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


/* ── 左栏作者卡：吸顶收起 / 回顶展开 ──────────────────────
   导航栏里已经有一个头像 +「清吾」，左栏这张跟它同屏时重复得很明显。
   规则：左栏粘住（sticky 到 top-24）时收起，回到顶部再展开。 */
console.log('\n【作者卡收起】');
const authorState = () =>
  page.evaluate(() => {
    const c = document.querySelector('[data-author-card]');
    if (!c) return null;
    return {
      collapsed: c.classList.contains('is-collapsed'),
      h: Math.round(c.getBoundingClientRect().height),
      top: Math.round(c.getBoundingClientRect().top),
      wired: window.__qAuthor === true,
    };
  });

verdict((await page.evaluate(() => window.__qAuthor === true)), '作者卡脚本已接线（__qAuthor）');

await page.evaluate(() => window.scrollTo(0, 0));
await sleep(700);
const aTop = await authorState();
verdict(aTop && !aTop.collapsed && aTop.h > 100, '顶部：作者卡展开', `h=${aTop?.h} collapsed=${aTop?.collapsed}`);

// 逐档滚到吸顶（800 处测过是粘住的位置），中间位置不该提前收起
await page.evaluate(() => window.scrollTo(0, 700));
await sleep(700);
const aMid = await authorState();
verdict(aMid && !aMid.collapsed, '未吸顶时（y=700）仍展开', `top=${aMid?.top} collapsed=${aMid?.collapsed}`);

await page.evaluate(() => window.scrollTo(0, 900));
await sleep(800);
const aStuck = await authorState();
verdict(aStuck && aStuck.collapsed && aStuck.h <= 4, '吸顶后收起（不再有两个头像同屏）', `h=${aStuck?.h} collapsed=${aStuck?.collapsed}`);

await page.evaluate(() => window.scrollTo(0, 0));
await sleep(800);
const aBack = await authorState();
verdict(aBack && !aBack.collapsed && aBack.h > 100, '回到顶部重新展开', `h=${aBack?.h} collapsed=${aBack?.collapsed}`);

/* ── 左栏三张卡（作者 / 音乐馆 / 按分类看）─────────────── */
console.log('\n【左栏三张卡】');
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(600);
const leftCards = await page.evaluate(() => {
  const aside = document.querySelector('aside[aria-label="关于与分类"]');
  if (!aside) return null;
  const author = aside.querySelector('[data-author-card]');
  // 取整张卡（标题链接只是卡里的一行）；用 closest 而不是 a 本身，
  // 否则量到的是那行 17px 高的链接，会误判成「卡片是空壳」
  const music = aside.querySelector('a[href="/music"]')?.closest('.glass-card') ?? null;
  const cats = Array.from(aside.querySelectorAll('.glass-card')).find((c) =>
    (c.textContent || '').includes('按分类看'),
  );
  const box = (e) => (e ? { top: Math.round(e.getBoundingClientRect().top), h: Math.round(e.getBoundingClientRect().height) } : null);
  return {
    author: box(author),
    music: box(music),
    cats: box(cats),
    musicText: music ? (music.textContent || '').replace(/\s+/g, ' ').trim() : '',
    musicTitle: (music?.querySelector('[data-music-title]')?.textContent || '').trim(),
  };
});
verdict(
  !!leftCards?.author && !!leftCards?.music && !!leftCards?.cats,
  '左栏有三张卡（作者 / 音乐馆 / 按分类看）',
  leftCards ? `作者 ${leftCards.author?.h} · 音乐 ${leftCards.music?.h} · 分类 ${leftCards.cats?.h}` : '缺卡',
);
verdict(
  leftCards?.author?.top < leftCards?.music?.top && leftCards?.music?.top < leftCards?.cats?.top,
  '顺序是作者 → 音乐馆 → 分类（音乐卡在中间）',
  leftCards ? `${leftCards.author?.top} / ${leftCards.music?.top} / ${leftCards.cats?.top}` : '',
);
verdict(
  (leftCards?.music?.h ?? 0) > 60,
  '音乐卡有实际高度（不是空壳）',
  `h=${leftCards?.music?.h}`,
);
// 曲名不能是空字符串（服务端要能渲染出第一首，否则水合前是一块空白）
verdict(
  (leftCards?.musicTitle || '').length > 0 && /音乐馆/.test(leftCards?.musicText || ''),
  '音乐卡渲染出曲名',
  leftCards?.musicTitle,
);

/* ── 音乐卡能控制，且与全站播放器联动 ────────────────────
   左栏卡与 MiniPlayer、/music 页操作的是同一个 store，store 一变就 emit()，
   三处同时刷新。这里验「首页点播放 → 跳到别页，迷你播放器已经是同一首且在播」。 */
console.log('\n【音乐卡控制】');
const ctrl = await page.evaluate(() => {
  const aside = document.querySelector('aside[aria-label="关于与分类"]');
  const card = aside.querySelector('a[href="/music"]')?.closest('.glass-card');
  if (!card) return null;
  const modeBtn = card.querySelector('button[aria-label^="播放模式"]');
  const cover = card.querySelector('img');
  const bar = card.querySelector('[role="slider"]');
  // ⚠️ 别用 .tabular-nums 取时间：时间行的父 div 自己也带这个类，
  // 直接 textContent 会把「0:00」和「0:00」拼成「0:000:00」
  const times = Array.from(card.querySelectorAll('[data-music-time] > span')).map((e) =>
    (e.textContent || '').trim(),
  );
  return {
    prev: !!card.querySelector('button[aria-label="上一首"]'),
    play: !!card.querySelector('button[aria-label="播放"], button[aria-label="暂停"]'),
    next: !!card.querySelector('button[aria-label="下一首"]'),
    mode: modeBtn ? modeBtn.getAttribute('aria-label') : null,
    bar: !!bar,
    times,
    coverLoaded: cover ? cover.naturalWidth > 0 : null,
    title: (card.querySelector('[data-music-title]')?.textContent || '').trim(),
  };
});
verdict(
  ctrl?.prev && ctrl?.play && ctrl?.next && ctrl?.mode,
  '音乐卡有循环 / 上一首 / 播放 / 下一首',
  ctrl ? `prev=${ctrl.prev} play=${ctrl.play} next=${ctrl.next} mode=${!!ctrl.mode}` : '未找到',
);
verdict(ctrl?.bar, '音乐卡有可点的进度条（role=slider）', ctrl?.bar ? '可取 aria-valuenow' : '缺失');
verdict(
  Array.isArray(ctrl?.times) &&
    ctrl.times.length === 2 &&
    ctrl.times.every((x) => /^\d+:\d{2}$/.test(x)),
  '时间是「已播 / 总长」两段 m:ss',
  (ctrl?.times || []).join(' / '),
);
verdict(
  ctrl?.coverLoaded === true,
  '专辑封面真的加载了（不是兜底图标）',
  ctrl?.coverLoaded === true ? 'naturalWidth > 0' : `coverLoaded=${ctrl?.coverLoaded}`,
);

// 点播放
if (ctrl) {
  await page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="关于与分类"]');
    aside.querySelector('button[aria-label="播放"]')?.click();
  });
  /* 轮询而不是固定 sleep：音频在对象存储上，play() 的 promise 要等数据到位才 resolve，
     慢的时候 1.5s 根本不够 —— 用固定等待会时不时报一次假失败（实测踩过两次）。
     最多等 8s，一变「暂停」就算过。 */
  const readCtl = () =>
    page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="关于与分类"]');
      return {
        label: aside
          .querySelector('button[aria-label="暂停"], button[aria-label="播放"]')
          ?.getAttribute('aria-label'),
        title: (aside.querySelector('[data-music-title]')?.textContent || '').trim(),
      };
    });
  let playing = await readCtl();
  for (let i = 0; i < 16 && playing.label !== '暂停'; i++) {
    await sleep(500);
    playing = await readCtl();
  }
  verdict(playing.label === '暂停', '点播放后按钮变成「暂停」', `aria-label=${playing.label}`);

  // 下一首：曲名应变化（13 首循环，第 1 首的下一首必然不同）
  await page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="关于与分类"]');
    aside.querySelector('button[aria-label="下一首"]')?.click();
  });
  await sleep(900);
  const afterNext = await page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="关于与分类"]');
    return (aside.querySelector('[data-music-title]')?.textContent || '').trim();
  });
  verdict(afterNext && afterNext !== playing.title, '点下一首后曲名变了', `${playing.title} → ${afterNext}`);

  /* 联动：跳到 /blog（MiniPlayer 只在这种页面渲染），它应显示同一首、且在播。
     MiniPlayer 是 client:only，给它 2s 挂载。 */
  await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('header nav a')).find((x) =>
      (x.textContent || '').trim().startsWith('文章'),
    );
    a?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  });
  await sleep(2200);
  // 把当前曲名带进页面上下文再比对，别在 evaluate 里直接引用 Node 侧变量
  const mini = await page.evaluate((wantTitle) => {
    const btns = Array.from(
      document.querySelectorAll('button[aria-label="暂停"], button[aria-label="播放"]'),
    ).filter((b) => !b.closest('aside[aria-label="关于与分类"]'));
    return {
      path: location.pathname,
      labels: btns.map((b) => b.getAttribute('aria-label')),
      hasTitle: (document.body.textContent || '').includes(wantTitle),
    };
  }, afterNext);
  verdict(mini.path !== '/', '已切到其它页面', mini.path);
  verdict(
    mini.labels.length > 0 && mini.labels.every((l) => l === '暂停'),
    '迷你播放器同步显示「暂停」（同一 store 联动）',
    `按钮：${mini.labels.join(' / ') || '未渲染'}`,
  );

  // 回到首页前先停掉，避免后续断言受播放影响
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button[aria-label="暂停"]'));
    b[b.length - 1]?.click();
  });
  await sleep(500);
}

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

/* ── 右栏吸顶 ────────────────────────────────────────────────
   左栏一直是 sticky、右栏不是，于是滚过一屏之后右边整片空白、只剩中间一列在动。
   修的时候有个坑：右栏五张卡总高约 911px，比 1440×900 的视口还高，
   只写 position: sticky 的话超出视口的那截永远没机会露出来（最后一张卡等于消失）。
   所以判据不是「高度 = 视口」，而是三条：
     · 滚过一屏后 rect.top 仍等于 96（真的吸住了）
     · 内容没丢：要么内部可滚（scrollHeight > clientHeight），要么整栏装得下
     · 吸顶不引入横向溢出（负外边距 + 滚动条预留那几行最容易出错） */
// ⚠️ 这里必须新开一个 page：上面的 page 属于 ctx3，ctx3.close() 已经把它带走了
const railPage = await browser.newPage();

/** 读右栏状态。判据用「内容是否被裁」（scrollHeight > clientHeight）而不是固定高度 ——
    卡片内容是客户端渲染的，高度会随字体/数据轻微变化。 */
const readRail = () =>
  railPage.evaluate(() => {
    const r = document.querySelector('aside[aria-label="此刻"]');
    if (!r) return null;
    const cs = getComputedStyle(r);
    return {
      top: Math.round(r.getBoundingClientRect().top),
      pos: cs.position,
      content: r.scrollHeight,
      box: r.clientHeight,
      clipped: r.scrollHeight > r.clientHeight + 1,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      lastCard: !!r.lastElementChild,
    };
  });

/* ① 1440×900：右栏内容 742px ≤ 可用高度（视口 − 96 − 16 = 788）→ 吸顶，整列完整。
      ⚠️ 这个数是从 911 压下来的（脚印卡改横排三列、技术栈 chip 收小、间距 16→12）。
      压之前 911 > 788，右栏根本没法完整停住 —— 硬吸顶会把最后一张卡切一半。 */
await railPage.setViewport({ width: 1440, height: 900 });
await railPage.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1200);
await railPage.evaluate(() => window.scrollTo(0, 900));
await sleep(500);
let rail = await readRail();
verdict(rail?.pos === 'sticky', '900 高屏：装得下 → 右栏吸顶', `position=${rail?.pos}`);
verdict(rail?.top === 96, '900 高屏：吸在 top=96（与左栏同一条线）', `top=${rail?.top}`);
verdict(!rail?.clipped, '900 高屏：吸顶后内容完整（一张卡都没切）', `内容 ${rail?.content} / 可视 ${rail?.box}`);
verdict(rail?.overflowX <= 0, '900 高屏：不引入横向溢出', `越界 ${rail?.overflowX}px`);

/* ② 1440×700：可用 588 < 742 → 不吸顶。矮屏宁可不吸，也不能把卡片裁掉。 */
await railPage.setViewport({ width: 1440, height: 700 });
await railPage.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1200);
rail = await readRail();
verdict(rail?.pos === 'static', '700 高屏：装不下 → 不吸顶（不裁不滚）', `position=${rail?.pos}`);
verdict(!rail?.clipped, '700 高屏：右栏内容不被裁', `内容 ${rail?.content} / 可视 ${rail?.box}`);
verdict(!!rail?.lastCard, '右栏最后一张卡还在（吸顶没吃掉内容）');
await railPage.close();

console.log(`\n合计失败 ${failed} 项`);
await browser.close();
process.exit(failed ? 1 : 0);
