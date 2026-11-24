// 给文章截真实页面图（不是示意图）。
//
// 用系统 Chrome + puppeteer-core，不下载 Chromium。
// 输出 webp（本站图片统一 webp，体积比 png 小一半以上）。
//
// 用法：
//   node scripts/shoot-articles.mjs            # 全部
//   node scripts/shoot-articles.mjs music      # 只截名字里带 music 的
//
// ⚠️ 截的是**线上**页面，不是在本地 dev 起来的那份 —— 文章配图要跟读者看到的一致。

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'https://www.qingwu.ink';
const OUT = 'shots/articles';

/** 每种屏宽只截「首屏 + 关键区域」，不做整页长图（文章里读不动）。 */
const TARGETS = [
  { name: 'music-desktop', path: '/music/', w: 1440, h: 860, wait: 2600 },
  { name: 'music-mobile', path: '/music/', w: 390, h: 844, wait: 2600, mobile: true },
  { name: 'links-board', path: '/links/', w: 1440, h: 900, wait: 2200 },
  { name: 'board-comments', path: '/links/', w: 1440, h: 900, wait: 2400, anchor: '#friends-comments' },
  { name: 'blog-list', path: '/blog/', w: 1440, h: 900, wait: 1800 },
  { name: 'post-reading', path: '/blog/toc-highlight-and-contrast/', w: 1440, h: 900, wait: 1800 },
  { name: 'home', path: '/', w: 1440, h: 900, wait: 2800 },
];

const only = process.argv[2];

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // 这台机器上有代理相关设置会让 headless Chrome 连不上（curl 正常但 Chrome 超时），
  // 所以显式禁用代理、忽略证书问题、只走 IPv4 —— 截图是本地工具，不需要这些网络特性。
  args: [
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--font-render-hinting=none',
    '--no-proxy-server',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--ignore-certificate-errors',
  ],
});

try {
  for (const t of TARGETS) {
    if (only && !t.name.includes(only)) continue;

    const page = await browser.newPage();
    await page.setViewport({
      width: t.w,
      height: t.h,
      deviceScaleFactor: 2, // 文章里会缩放显示，2x 保证清晰
      isMobile: !!t.mobile,
      hasTouch: !!t.mobile,
    });

    // 不用 networkidle2：音乐页要拉音频、打点还会一直发，网络永远「不空闲」。
    // 用 load 等骨架，再靠下面的固定等待让动效落定。
    // 这条线路偶尔整个超时（curl 也会），所以最多试三次。
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await page.goto(BASE + t.path, { waitUntil: 'load', timeout: 60000 });
        ok = true;
      } catch (e) {
        if (attempt === 3) throw e;
        console.warn(`  · ${t.name} 第 ${attempt} 次超时，重试`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    // 有的图要截页面中段（比如留言板在 /links/ 最底部），先滚过去再等动效
    if (t.anchor) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' });
      }, t.anchor);
    }

    // 开屏、滚动动效、歌词定位都要时间落定，不能拍太早
    await new Promise((r) => setTimeout(r, t.wait));

    const file = `${OUT}/${t.name}.webp`;
    await page.screenshot({ path: file, type: 'webp', quality: 82 });
    console.log('✓', file);
    await page.close();
  }
} finally {
  await browser.close();
}
