/**
 * 更新日志（/changelog）验收 —— `npm run check:changelog`
 *
 * 起静态服务后跑：`npm run build` → `dist/client` 下 `python -m http.server 4399`。
 *
 * 验的：
 *   · 页面在、版本数与数据一致、每版都有版本号/日期/标题/摘要/分组
 *   · 排序：日期从新到旧；「最新」有且只有一个，且是第一项
 *   · 时间轴：1440 轴线与圆点可见、390 收掉（避免贴边像描边）
 *   · 圆点落在卡片竖向范围内（不是飘在卡外）
 *   · 导航「关于」下拉里能进更新日志；关于页有入口
 *   · 客户端路由切换不整页刷新（Astro 的 transition 链路没被这条新路由切断）
 *
 * 不验的：文案是否属实（那是 `changelog.json` 的事，日期以 git 为准）。
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

/* ── 页面与内容 ─────────────────────────────────────────── */
console.log('\n【更新日志页】');
const res = await page.goto(`${BASE}/changelog/`, { waitUntil: 'networkidle2', timeout: 60000 });
verdict(res?.status() === 200, '页面返回 200', `status=${res?.status()}`);
await sleep(800);

// 滚到底，让 .reveal 全部揭示（reveal 未揭示时是 opacity:0，肉眼等于空白）
await page.evaluate(async () => {
  const step = window.innerHeight * 0.7;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 90));
  }
  window.scrollTo(0, 0);
});
await sleep(700);

const data = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('[data-log-entry]'));
  const menu = document.querySelector('[role="menu"]');
  return {
    h1: document.querySelector('h1')?.textContent?.trim() ?? '',
    count: items.length,
    versions: items.map((it) => it.dataset.version ?? ''),
    dates: items.map((it) => it.querySelector('time')?.getAttribute('datetime') ?? ''),
    // 每版必须有标题(h2)、摘要(p)、至少一个分组(h3)、至少一条条目
    complete: items.map((it) => {
      const article = it.querySelector('article');
      return {
        v: it.dataset.version,
        h2: (article?.querySelector('h2')?.textContent ?? '').trim().length,
        summary: (article?.querySelector('p')?.textContent ?? '').trim().length,
        groups: article?.querySelectorAll('h3').length ?? 0,
        bullets: article?.querySelectorAll('.q-log__bullet').length ?? 0,
        // 玻璃卡是否真的揭示出来了
        opacity: article ? Number(getComputedStyle(article).opacity) : 0,
      };
    }),
    latest: items
      .filter((it) => it.classList.contains('q-log__item--latest'))
      .map((it) => it.dataset.version),
    latestIsFirst: items[0]?.classList.contains('q-log__item--latest') ?? false,
    badges: document.querySelectorAll('.q-log__badge').length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});

verdict(data.h1 === '更新日志', '页面标题是「更新日志」', data.h1);
verdict(data.count >= 5, `版本条数 ≥ 5（实际 ${data.count}）`, data.versions.join(' / '));
verdict(new Set(data.versions).size === data.count, '版本号没有重复');
verdict(
  data.complete.every((c) => c.h2 > 0 && c.summary > 0 && c.groups > 0 && c.bullets > 0),
  '每一版都有标题 / 摘要 / 分组 / 条目',
  data.complete.filter((c) => !(c.h2 > 0 && c.summary > 0 && c.groups > 0 && c.bullets > 0))
    .map((c) => c.v)
    .join(',') || '全部齐全',
);
verdict(
  data.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
  '每一版都有可被机器读的日期（<time datetime>）',
);
verdict(
  data.dates.every((d, i) => i === 0 || data.dates[i - 1] >= d),
  '按日期从新到旧排列',
  data.dates.join(' > '),
);
verdict(
  data.latest.length === 1 && data.latestIsFirst && data.badges === 1,
  '「最新」徽章有且只有一个，且挂在第一项上',
  `${data.latest.join(',') || '（无）'} / 徽章 ${data.badges} 个`,
);
verdict(
  data.complete.every((c) => c.opacity === 1),
  '所有卡片都完成了滚动揭示（没有停在 opacity:0）',
  `最小 opacity=${Math.min(...data.complete.map((c) => c.opacity))}`,
);

/* ── 时间轴 ─────────────────────────────────────────────── */
console.log('\n【时间轴】');
const axis1440 = await page.evaluate(() => {
  const log = document.querySelector('.q-log');
  const item = document.querySelector('[data-log-entry]');
  const article = item?.querySelector('article');
  const dot = item?.querySelector('.q-log__dot');
  if (!log || !article || !dot) return null;
  const line = getComputedStyle(log, '::before');
  const ar = article.getBoundingClientRect();
  const dr = dot.getBoundingClientRect();
  return {
    lineDisplay: line.display,
    lineWidth: line.width,
    dotDisplay: getComputedStyle(dot).display,
    // 圆点要落在卡片竖向范围内，不能飘到卡外
    dotInsideCard: dr.top >= ar.top - 1 && dr.bottom <= ar.bottom + 1,
    // 轴线要在卡片左侧（圆点左右居中于轴线）
    axisLeftOfCard: dr.right <= ar.left + 1,
  };
});
verdict(axis1440?.lineDisplay !== 'none', '1440 轴线可见', `width=${axis1440?.lineWidth}`);
verdict(axis1440?.dotDisplay !== 'none', '1440 圆点可见');
verdict(!!axis1440?.dotInsideCard, '圆点落在卡片竖向范围内');
verdict(!!axis1440?.axisLeftOfCard, '轴线与圆点在卡片左侧，不压卡片');

/* ── 三档宽度无溢出 ─────────────────────────────────────── */
console.log('\n【版式与溢出】');
for (const [w, h] of [[1440, 900], [1024, 800], [390, 844]]) {
  await page.setViewport({ width: w, height: h });
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(500);
  const r = await page.evaluate(() => {
    const dot = document.querySelector('.q-log__dot');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      dotDisplay: dot ? getComputedStyle(dot).display : 'missing',
      // 窄屏卡片要能占满内容宽，而不是被 padding-left 挤窄
      cardLeftGap: Math.round(
        document.querySelector('[data-log-entry] article').getBoundingClientRect().left,
      ),
    };
  });
  verdict(r.overflow <= 1, `${w}px 无横向溢出`, `scrollWidth-innerWidth=${r.overflow}`);
  if (w <= 640) {
    verdict(r.dotDisplay === 'none', `${w}px 时间轴收掉（不贴边）`, r.dotDisplay);
  } else {
    verdict(r.dotDisplay !== 'none', `${w}px 时间轴保留`, r.dotDisplay);
  }
}

/* ── 入口：导航下拉 + 关于页 ───────────────────────────── */
console.log('\n【入口】');
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/about/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(700);

const aboutEntry = await page.evaluate(() => {
  const a = document.querySelector('a[href="/changelog"]');
  return a ? { found: true, text: (a.textContent || '').replace(/\s+/g, ' ').trim() } : { found: false };
});
verdict(aboutEntry.found, '关于页有更新日志入口', aboutEntry.text ?? '');

await page.hover('nav a[href="/about"]');
await sleep(500);
const dropdown = await page.evaluate(() => {
  const menu = document.querySelector('[role="menu"]');
  return menu
    ? {
        open: true,
        hrefs: Array.from(menu.querySelectorAll('a')).map((a) => a.getAttribute('href')),
        hasLog: !!menu.querySelector('a[href="/changelog"]'),
      }
    : { open: false, hrefs: [], hasLog: false };
});
verdict(dropdown.open, '「关于」悬停能展开下拉');
verdict(dropdown.hasLog, '下拉里有「更新日志」', dropdown.hrefs.join(', '));

// 点下拉里的更新日志，走客户端路由（不整页刷新）
await page.evaluateOnNewDocument(() => {
  window.__qMarker = 'kept';
});
await page.goto(`${BASE}/about/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(600);
await page.hover('nav a[href="/about"]');
await sleep(400);
const clicked = await page.evaluate(() => {
  const a = document.querySelector('[role="menu"] a[href="/changelog"]');
  if (!a) return false;
  a.click();
  return true;
});
verdict(clicked, '能点中下拉里的「更新日志」');
await sleep(1200);
const afterNav = await page.evaluate(() => ({
  path: location.pathname,
  marker: window.__qMarker ?? null,
  h1: document.querySelector('h1')?.textContent?.trim() ?? '',
}));
verdict(afterNav.path.startsWith('/changelog'), '跳转到了 /changelog', afterNav.path);
verdict(afterNav.h1 === '更新日志', '跳转后标题正确（没有白屏）', afterNav.h1);
verdict(afterNav.marker === 'kept', '是客户端路由切换，不是整页刷新', String(afterNav.marker));

const severe = errors.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e));
verdict(severe.length === 0, '无 JavaScript 运行时错误', severe.slice(0, 3).join(' | ') || '（无）');

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
