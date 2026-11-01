/**
 * 字体渲染验证（第二版）。
 *
 * 第一版用「汉字宽度是否相同」判断方框字 —— 误报满屏，因为标题字体
 * ZCOOL XiaoWei 本身是等宽设计的，所有汉字宽度就是一样。宽度不能用作判据。
 *
 * 第二版改为**画到 canvas 比对像素**：把字逐个渲染成 bitmap，
 * 若两个不同汉字的位图完全相同（容差内），说明都退化成了 .notdef 方框。
 * 这是唯一可靠的判据。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/hjiap/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const BASE = 'http://127.0.0.1:4399';
const PAGES = [
  '/',
  '/blog/',
  '/about/',
  '/links/',
  '/share/',
  '/music/',
  '/projects/',
  '/blog/offline-python-quiz-app/',
  '/404.html',
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--font-render-hinting=none', '--no-proxy-server', '--proxy-bypass-list=127.0.0.1;localhost'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  let grandBad = 0;
  for (const p of PAGES) {
    let report;
    try {
      await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 30000 });
      report = await page.evaluate(async () => {
        await document.fonts.ready;

        const cv = document.createElement('canvas');
        cv.width = 64;
        cv.height = 64;
        const cx = cv.getContext('2d', { willReadFrequently: true });

        // 渲染单个字，返回像素签名（非空白像素的坐标+灰度序列）
        function sig(ch, fontCss) {
          cx.clearRect(0, 0, 64, 64);
          cx.font = fontCss;
          cx.textBaseline = 'top';
          cx.fillStyle = '#000';
          cx.fillText(ch, 4, 4);
          const d = cx.getImageData(0, 0, 64, 64).data;
          let ink = 0;
          let h = 0;
          for (let i = 3; i < d.length; i += 4) {
            const a = d[i];
            if (a > 32) {
              ink++;
              h = (h * 31 + (i >> 2)) | 0;
            }
          }
          return { ink, h };
        }

        const ELS = 'h1,h2,h3,.font-display,.q-empty__hand,.q-splash__greet,.q-lost__q';
        const els = Array.from(document.querySelectorAll(ELS));
        const bad = [];
        const checked = new Set();

        for (const el of els) {
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          const fontCss = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const chars = Array.from((el.textContent || '').replace(/\s/g, '')).filter((c) =>
            /[\u4e00-\u9fff\u3040-\u30ff]/.test(c)
          );
          if (chars.length < 2) continue;

          // 签名相同的不同字 = 都画成了同一个符号（.notdef）
          const seen = new Map();
          for (const ch of chars) {
            const s = sig(ch, fontCss);
            if (s.ink === 0) {
              bad.push({ why: '空白', ch, family: cs.fontFamily.split(',')[0], text: (el.textContent || '').trim().slice(0, 16) });
              continue;
            }
            const key = `${s.ink}:${s.h}`;
            if (seen.has(key) && seen.get(key) !== ch) {
              const pair = `${seen.get(key)}|${ch}`;
              if (!checked.has(pair)) {
                checked.add(pair);
                bad.push({ why: '同形', pair, family: cs.fontFamily.split(',')[0], text: (el.textContent || '').trim().slice(0, 16) });
              }
            } else {
              seen.set(key, ch);
            }
          }
        }

        const loaded = [];
        document.fonts.forEach((f) => loaded.push(`${f.family}:${f.status}`));

        return {
          bad,
          loaded,
          hasDisplay: document.fonts.check('1em "ZCOOL XiaoWei"'),
          hasHand: document.fonts.check('1em "Ma Shan Zheng"'),
          els: els.length,
        };
      });
    } catch (e) {
      console.log(`${p.padEnd(36)} 失败: ${String(e).split('\n')[0]}`);
      continue;
    }

    grandBad += report.bad.length;
    const flag = report.bad.length === 0 ? 'PASS' : 'FAIL';
    console.log(
      `${flag}  ${p.padEnd(36)} 元素${String(report.els).padStart(3)}  display=${report.hasDisplay ? 'OK' : 'MISS'} hand=${report.hasHand ? 'OK' : 'MISS'} 缺字=${report.bad.length}`
    );
    for (const b of report.bad.slice(0, 8)) {
      console.log(`       ${b.why}  ${b.pair || b.ch}  字体=${b.family}  元素「${b.text}」`);
    }
  }

  console.log(`\n合计缺字/方框：${grandBad}`);
  console.log('浏览器错误：', errors.length ? errors.join('\n  ') : '（无）');
  await browser.close();
})();
