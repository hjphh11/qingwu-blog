// 视觉回归：三档断点下核对关键元素的计算样式（样式拆分后应当与之前一致）
import puppeteer from 'file:///C:/Users/hjiap/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:4399';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-web-security'],
});

const pages = ['/', '/about/', '/blog/', '/music/', '/links/'];
const widths = [1440, 1024, 390];
const errs = [];

for (const w of widths) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: 900 });
  page.on('pageerror', (e) => errs.push(`${w}px ${e.message.slice(0, 120)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(`${w}px console: ${m.text().slice(0, 120)}`);
  });

  for (const p of pages) {
    await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(900);

    const r = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const cs = (el, k) => (el ? getComputedStyle(el)[k] : null);

      const shell = q('.page-shell');
      const title = q('.page-head__title') || q('h1');
      const chip = q('.chip');
      const card = q('.glass-card');
      const nav = q('nav a') || q('header a');

      return {
        title: document.title.slice(0, 20),
        shellLeft: shell ? Math.round(shell.getBoundingClientRect().left) : null,
        titleLeft: title ? Math.round(title.getBoundingClientRect().left) : null,
        titleFont: cs(title, 'fontFamily')?.split(',')[0],
        titleSize: cs(title, 'fontSize'),
        bodyBg: cs(document.body, 'backgroundColor'),
        inkColor: cs(document.body, 'color'),
        chipRadius: cs(chip, 'borderRadius'),
        cardRadius: cs(card, 'borderRadius'),
        cardBg: cs(card, 'backgroundColor'),
        navRadius: cs(nav, 'borderRadius'),
        cssVarCrimson: getComputedStyle(document.documentElement).getPropertyValue('--color-crimson').trim(),
        cssVarShell: getComputedStyle(document.documentElement).getPropertyValue('--text-page').trim(),
      };
    });
    console.log(`${String(w).padStart(4)}px ${p.padEnd(9)} ${JSON.stringify(r)}`);
  }
  await page.close();
}

console.log('\n--- 错误 ---');
console.log(errs.length ? [...new Set(errs)].slice(0, 8).join('\n') : '（无）');
await browser.close();
