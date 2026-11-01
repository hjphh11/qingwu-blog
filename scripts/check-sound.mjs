/**
 * 第 8 条（声音页）验收 —— `npm run check:sound`
 *
 * v6 §8.3 五条里，与光场无关的都在这里验：
 *   ① 13 首歌可播、歌词逐行高亮
 *   ② 翻卡 3D 正常，**正反面文字不镜像**
 *   ③ 暂停播放后频谱回落到静止
 *   ④ 分享页从客户端路由进入后筛选/翻卡仍然可用（新修的 bug）
 *
 * 「切 tab 只改光场色温、场景不重建」依赖已回退的光场，做不了（见 §8.5）。
 *
 * 用生产产物跑（回归脚本硬编码 127.0.0.1:4399），并且必须放行自动播放：
 * 频谱要真实播放才有数据，而 headless 没有用户手势。
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
  args: [
    '--no-sandbox',
    '--no-proxy-server',
    '--proxy-bypass-list=127.0.0.1;localhost',
    // 频谱要真的播起来才有数据；headless 里没有用户手势
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

/* ── ① 13 首可播 + 歌词高亮 ───────────────────────────────── */
console.log('\n【音乐】');
await page.goto(`${BASE}/music/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1200);

const listInfo = await page.evaluate(() => {
  // 歌单在「列表」tab 里，先切过去
  const tabs = Array.from(document.querySelectorAll('button')).filter((b) =>
    /列表|歌单/.test(b.textContent || ''),
  );
  tabs[0]?.click();
  return { tabClicked: !!tabs[0] };
});
await sleep(500);

const trackCount = await page.evaluate(() => {
  const rows = document.querySelectorAll('[data-line], li');
  // 用 data-song 或列表容器数：优先找「播放这首歌」的行
  const byIndex = document.querySelectorAll('[data-track]');
  void rows;
  return byIndex.length;
});
void trackCount;
void listInfo;

// 更稳的判据：直接数 playlist 条目的歌名文本（data-track 是新加的钩子，见页面）
const tracks = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-track-title]'));
  return els.map((e) => (e.textContent || '').trim());
});
verdict(tracks.length === 13, '13 首歌都在列表里', `实际 ${tracks.length} 首`);
verdict(
  tracks.every((t) => t.length > 0),
  '每首都有标题',
  tracks.slice(0, 3).join(' / '),
);

// 歌词逐行高亮：点第 7 行歌词，当前行应当变成它（点击即 seek）
const lrc = await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('button')).filter((b) =>
    /歌词/.test(b.textContent || ''),
  );
  tabs[0]?.click();
  return !!tabs[0];
});
await sleep(400);
const lyricProbe = await page.evaluate(() => {
  const lines = Array.from(document.querySelectorAll('[data-line]'));
  if (lines.length < 8) return { ok: false, reason: `只有 ${lines.length} 行` };
  const before = document.querySelector('.text-crimson[data-line]')?.getAttribute('data-line');
  lines[6].click();
  return { ok: true, before, total: lines.length, target: 6 };
});
await sleep(600);
const afterLine = await page.evaluate(
  () => document.querySelector('[data-line].text-crimson')?.getAttribute('data-line') ?? null,
);
verdict(lyricProbe.ok, '歌词有多行', lrc ? `共 ${lyricProbe.total} 行` : 'tab 未切到歌词');
verdict(
  afterLine === String(lyricProbe.target),
  '点歌词行后高亮跟着切（seek + 高亮联动）',
  `第 ${lyricProbe.target} 行 → 高亮 data-line=${afterLine}`,
);

/* ── ③ 频谱：播放时在动、暂停后回落静止 ────────────────────── */
console.log('\n【频谱（AnalyserNode 实测）】');

const playState = await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="播放"]');
  b?.click();
  return { clicked: !!b };
});
verdict(playState.clicked, '找到并点击了播放按钮');

// 等它真的出声音（先等着缓冲）
let audioInfo = null;
for (let i = 0; i < 25; i++) {
  await sleep(400);
  audioInfo = await page.evaluate(() => {
    // 音频元素是 `new Audio()`，不在文档里 —— 只能看 UI 的进度条。
    // 进度由 timeupdate 驱动，所以宽度真涨了就说明音频在走，不是只改了状态位。
    const bar = document.querySelector('[data-q-progress]');
    const spectrum = document.querySelector('[data-q-spectrum]');
    return {
      pct: bar ? parseFloat(bar.style.width) || 0 : 0,
      state: spectrum?.getAttribute('data-state') ?? null,
      bars: spectrum ? spectrum.children.length : 0,
    };
  });
  if (audioInfo.pct > 0) break;
}
verdict(
  audioInfo && audioInfo.pct > 0,
  '音频真的在走（进度条由 timeupdate 驱动）',
  `进度 ${audioInfo?.pct}%`,
);
verdict(audioInfo?.state === 'on', '频谱已激活', `data-state=${audioInfo?.state}`);
verdict(audioInfo?.bars === 40, '40 根柱子都在', `实际 ${audioInfo?.bars} 根`);

// 采两帧，比较柱子的 scaleY：真实频谱一定在变；随机假动画也可能变，
// 所以还要看「低频段整体高于高频段」这种只有真数据才有的形状。
const sample = async () =>
  page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll('[data-q-spectrum] > span'));
    return bars.map((b) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(b).transform);
      return Number(m.d.toFixed(4)); // scaleY
    });
  });

const s1 = await sample();
await sleep(500);
const s2 = await sample();
const diff = s1.reduce((acc, v, i) => acc + Math.abs(v - s2[i]), 0) / s1.length;
const maxLevel = Math.max(...s1, ...s2);
verdict(diff > 0.004, '柱子随音频变化（不是一张静止图）', `平均变化 ${diff.toFixed(4)}`);
verdict(maxLevel > 0.03, '电平不是全 0（crossOrigin/CORS 正常）', `峰值 scaleY=${maxLevel.toFixed(3)}`);

const lowMid = (arr) => {
  const low = arr.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  const high = arr.slice(28).reduce((a, b) => a + b, 0) / 12;
  return { low, high };
};
const pinned = [...s1, ...s2].filter((v) => v > 0.98).length / (s1.length + s2.length);
verdict(pinned < 0.5, '柱子没有大面积顶格（增益留了余量）', `顶格比例 ${(pinned * 100).toFixed(0)}%`);

const band = lowMid(s1);
verdict(
  band.low >= band.high,
  '低频段能量 ≥ 高频段（对数分桶 + 倾斜补偿后应有的形状）',
  `low=${band.low.toFixed(3)} high=${band.high.toFixed(3)}`,
);

// 暂停 → 回落
await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="暂停"]');
  b?.click();
});
await sleep(1600);
const paused = await page.evaluate(() => {
  const spectrum = document.querySelector('[data-q-spectrum]');
  const bars = Array.from(spectrum?.children ?? []);
  const vals = bars.map((b) => Number(new DOMMatrixReadOnly(getComputedStyle(b).transform).d.toFixed(4)));
  return {
    state: spectrum?.getAttribute('data-state') ?? null,
    max: vals.length ? Math.max(...vals) : null,
  };
});
verdict(paused.state === 'off', '暂停后频谱隐藏', `data-state=${paused.state}`);
verdict(paused.max !== null && paused.max < 0.05, '暂停后柱子回落到静止', `最大 scaleY=${paused.max}`);

/* ── ② 翻卡 3D + 文字不镜像 + ④ 客户端路由进入后仍可用 ──────── */
console.log('\n【分享页 3D 翻卡】');
await page.goto(`${BASE}/share/`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1000);

const flipGeom = await page.evaluate(() => {
  const card = document.querySelector('.flip-card[data-type="quote"]');
  if (!card) return { ok: false };
  const inner = card.querySelector('.flip-inner');
  const cs = getComputedStyle(inner);
  return {
    ok: true,
    transformStyle: cs.transformStyle,
    // 玻璃必须挂在两个面上，不能挂 inner（挂 inner 会让 preserve-3d 实际失效）
    innerBackdrop: cs.backdropFilter,
    faceBackdrop: getComputedStyle(card.querySelector('.flip-face')).backdropFilter,
    faces: card.querySelectorAll('.flip-face').length,
    backface: getComputedStyle(card.querySelector('.flip-back')).backfaceVisibility,
  };
});
verdict(flipGeom.ok, '找到语录翻卡');
verdict(flipGeom.transformStyle === 'preserve-3d', '翻转层保留 3D', `transform-style=${flipGeom.transformStyle}`);
verdict(
  flipGeom.innerBackdrop === 'none',
  '玻璃效果没有挂在翻转层上（否则 3D 会失效）',
  `inner backdrop-filter=${flipGeom.innerBackdrop}`,
);
verdict(
  flipGeom.faceBackdrop !== 'none',
  '玻璃效果由两个面各自承担',
  `face backdrop-filter=${flipGeom.faceBackdrop.slice(0, 28)}…`,
);
verdict(flipGeom.backface === 'hidden', '背面做了 backface-visibility 处理', flipGeom.backface);

// 翻转后检查矩阵：行列式为正 = 旋转；为负 = 镜像（文字左右反）
await page.evaluate(() => {
  document.querySelector('.flip-card[data-type="quote"]')?.click();
});
await sleep(900);
const matrix = await page.evaluate(() => {
  const card = document.querySelector('.flip-card[data-type="quote"]');
  const inner = card.querySelector('.flip-inner');
  const back = card.querySelector('.flip-back');
  const mi = new DOMMatrixReadOnly(getComputedStyle(inner).transform);
  const mb = new DOMMatrixReadOnly(getComputedStyle(back).transform);
  // 合成矩阵 = 先从背面到 inner，再经 inner 的翻转。两处各转 180° → 应当回到单位矩阵。
  // ⚠️ 不能只看 inner 的 det：rotateY(180°) 的 2D 投影本来就 a=-1,d=1，det=-1，
  //    那是「翻到背面」的正常结果，不是镜像错误。判据必须落在**合成**上。
  const c = mi.multiply(mb);
  return {
    flipped: card.classList.contains('is-flipped'),
    inner: [mi.a, mi.b, mi.c, mi.d].map((v) => Number(v.toFixed(3))),
    back: [mb.a, mb.b, mb.c, mb.d].map((v) => Number(v.toFixed(3))),
    composed: [c.a, c.b, c.c, c.d].map((v) => Number(v.toFixed(3))),
  };
});
verdict(matrix.flipped, '点击后真的翻转了');
const [ca, cb, cc, cd] = matrix.composed;
verdict(
  Math.abs(ca - 1) < 0.02 && Math.abs(cd - 1) < 0.02 && Math.abs(cb) < 0.02 && Math.abs(cc) < 0.02,
  '翻转后合成矩阵是单位阵（正反面文字都不镜像）',
  `inner(${matrix.inner}) × back(${matrix.back}) = (${matrix.composed})`,
);

// ④ 从客户端路由进入分享页，筛选仍然可用（修的是「直接绑元素」的老 bug）
const routeProbe = await page.evaluate(async () => {
  // 先离开，再点站内链接回来 —— 模拟 ClientRouter 换 body
  const home = document.querySelector('a[href="/"]');
  home?.click();
  await new Promise((r) => setTimeout(r, 1200));
  return { left: location.pathname };
});
void routeProbe;
await sleep(1500);
const back = await page.evaluate(async () => {
  const link = document.querySelector('a[href="/share/"], a[href="/share"]');
  link?.click();
  await new Promise((r) => setTimeout(r, 1500));
  return { path: location.pathname };
});
await sleep(900);
const filterWorks = await page.evaluate(() => {
  const btn = document.querySelector('[data-share-filters] button[data-filter="quote"]');
  if (!btn) return { ok: false, reason: '筛选按钮不在' };
  btn.click();
  const pressed = btn.getAttribute('aria-pressed');
  const visible = Array.from(document.querySelectorAll('[data-share-list] [data-type]')).filter(
    (c) => !c.classList.contains('is-hidden'),
  );
  return {
    ok: true,
    pressed,
    visibleTypes: [...new Set(visible.map((c) => c.getAttribute('data-type')))],
  };
});
verdict(back.path === '/share/', '经客户端路由回到了分享页', `path=${back.path}`);
verdict(
  filterWorks.ok && filterWorks.pressed === 'true',
  '客户端路由进入后筛选按钮仍可用（老 bug 已修）',
  `aria-pressed=${filterWorks.pressed}`,
);
verdict(
  filterWorks.ok && filterWorks.visibleTypes.length === 1 && filterWorks.visibleTypes[0] === 'quote',
  '筛选真的生效（只剩语录卡）',
  `剩下 ${filterWorks.visibleTypes.join(',') || '无'}`,
);

/* ── 收尾 ─────────────────────────────────────────────── */
const severe = errors.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e));
verdict(severe.length === 0, '无 JavaScript 运行时错误', severe.slice(0, 3).join(' | ') || '（无）');

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
