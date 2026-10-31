// 全站左缘对齐验证：导航品牌 / 页标题 / 页脚，三档断点。
import puppeteer from 'file:///C:/Users/hjiap/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:4399';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
});

const pages = ['/about/', '/blog/', '/music/', '/links/', '/share/', '/links/apply/'];
const widths = [1440, 1280, 1024, 768, 390];
let bad = 0;

for (const w of widths) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: 900 });
  const rows = [];

  for (const p of pages) {
    await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(500);
    const r = await page.evaluate(() => {
      const L = (el) => (el ? Math.round(el.getBoundingClientRect().left) : null);
      const title = document.querySelector('.page-head__title');
      const brand = document.querySelector('header a');
      const foot = document.querySelector('footer .shell-inline');
      return { title: L(title), brand: L(brand), foot: L(foot) };
    });
    const d = r.brand != null && r.title != null ? r.brand - r.title : null;
    const fd = r.foot != null && r.title != null ? r.foot - r.title : null;
    if (d != null && Math.abs(d) > 1) bad++;
    rows.push(`${p.padEnd(14)} 标题${String(r.title).padStart(4)} 品牌${String(r.brand).padStart(4)} 差${String(d).padStart(3)} | 页脚${String(r.foot).padStart(4)} 差${String(fd).padStart(3)}`);
  }
  console.log(`\n=== ${w}px ===`);
  console.log(rows.join('\n'));
  await page.close();
}

console.log(bad === 0 ? '\n✅ 全部页面导航与页标题左缘对齐（误差 ≤ 1px）' : `\n❌ ${bad} 处未对齐`);
await browser.close();
