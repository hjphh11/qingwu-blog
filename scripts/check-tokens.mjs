#!/usr/bin/env node
/**
 * 样式纪律自查。
 *
 * 用法：node scripts/check-tokens.mjs
 * 有违规时退出码 1，可直接挂进 CI / pre-commit。
 *
 * 检查项对应 docs/重写保留约定清单.md：
 *   A1 手写 -webkit- 前缀（会被压缩器丢标准写法）
 *   A2 半透明正文色（text-ink/50 之类，对比度不够）
 *   A3 行宽用 ch（中文下 ch≈0.585em，会算错一半）
 *   A4 裸写时长（不走 --dur-* token）
 *   B1 .page-shell 被覆盖 max-w（会让左缘横跳）
 *   B2 容器写了第三套宽度（不走 --shell-max）
 *   C1 样式层出现循环依赖（分层必须是星形：index 单点汇总，叶子互不引用）
 *   C2 手改了脚本生成的产物（fonts.css 会被下次重跑覆盖掉）
 *   C3 var(--x) 引用了不存在的变量，且没写 fallback
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = 'src';
const EXTS = new Set(['.css', '.astro', '.tsx', '.ts']);

/** 收集所有源文件 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p))) out.push(p);
  }
  return out;
}

const files = walk(ROOT);

const RULES = [
  {
    id: 'A1',
    name: '手写 -webkit- 前缀',
    // 只查 backdrop-filter / mask，这两个是踩过的
    re: /-webkit-(backdrop-filter|mask-image|mask-size|mask-repeat)\s*:/,
    fix: '删掉手写前缀，交给 Lightning CSS 自动补。手写会被压缩器当重复声明丢掉。',
  },
  {
    id: 'A2',
    name: '半透明正文色',
    re: /\btext-ink\/[0-9]{2}\b/,
    fix: '正文用 text-ink，次要文字用 text-muted，三级用 text-subtle。',
  },
  {
    id: 'A3',
    name: '行宽用 ch 单位',
    re: /max-width:\s*[\d.]+ch\b/,
    fix: '中文限宽用 em。ch 是数字 0 的宽度，这个字体下 ch≈0.585em。',
  },
  {
    id: 'A4',
    name: '裸写过渡时长',
    // 只查 transition 与 animation-duration 之外的「档位型」时长。
    // **故意不查 animation 的周期**（唱片 8s、呼吸 1.25s）——
    // 那些是每个动效自己的节奏，不是语义档位，硬套 token 只会更难读。
    re: /\btransition\s*:[^;{]*?\b\d*\.?\d+m?s\b/,
    fix: '用 var(--dur-micro) / --dur-state / --dur-move / --dur-cinematic。',
    only: ['.css'],
  },
  {
    id: 'B1',
    name: '.page-shell 被覆盖 max-w',
    re: /page-shell[^"'`]*\bmax-w-/,
    fix: '.page-shell 是横轴唯一来源，窄栏要下沉到内层 div。',
  },
  {
    id: 'B2',
    name: '写死的容器宽度',
    // 正文/导航/页脚里不该再出现 1080 / max-w-4xl 这类硬值
    re: /\bmax-w-\[?10\d{2}px\]?|\bmax-w-[345]xl\b/,
    fix: '用 var(--shell-max) 或 .page-shell / .shell-inline。',
    // 允许在 styles/ 里作为 token 定义出现
    allow: /--shell-max/,
    only: ['.astro', '.tsx'],
  },
];

let violations = 0;
const report = [];

/* ── C1 样式层循环依赖 ─────────────────────────────────────────────
   分层约定是**星形**：index.css 汇总，7 个叶子文件互不 @import。
   只要叶子之间出现互相引用就可能有循环，这里真的建图跑一遍 DFS。 */
function checkStyleGraph() {
  const dir = join(ROOT, 'styles');
  const names = readdirSync(dir).filter((n) => n.endsWith('.css'));
  const edges = new Map();
  for (const n of names) {
    const src = readFileSync(join(dir, n), 'utf8');
    const deps = [...src.matchAll(/@import\s+["']\.\/([\w.-]+\.css)["']/g)].map((m) => m[1]);
    edges.set(n, deps);
  }
  const state = new Map(); // 1=访问中 2=已完成
  const cycles = [];
  const dfs = (n, stack) => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) {
      cycles.push([...stack.slice(stack.indexOf(n)), n].join(' → '));
      return;
    }
    state.set(n, 1);
    for (const d of edges.get(n) || []) if (edges.has(d)) dfs(d, [...stack, n]);
    state.set(n, 2);
  };
  for (const n of names) dfs(n, []);

  const hits = [];
  for (const c of cycles) hits.push(`循环依赖：${c}`);
  // 叶子（除 index/global 外）不应该再引别的层
  for (const [n, deps] of edges) {
    if (n === 'index.css' || n === 'global.css') continue;
    if (deps.length) hits.push(`${n} 反向引用了 ${deps.join(', ')}（叶子应互不依赖）`);
  }
  return hits;
}

/* ── C2 生成物被手改 ───────────────────────────────────────────────
   fonts.css 头部有「不要手改」的标记，正常生成时也只会有 2 个 @font-face。 */
function checkGenerated() {
  const hits = [];
  const p = join(ROOT, 'styles', 'fonts.css');
  try {
    const src = readFileSync(p, 'utf8');
    if (!src.includes('由 scripts/subset-fonts.py 生成')) {
      hits.push(`${p} 缺少「脚本生成」标记，可能被整份替换成手写内容了`);
    }
    if (!/@font-face/.test(src)) hits.push(`${p} 里没有 @font-face，跑一下 npm run fonts`);
  } catch {
    hits.push(`${p} 不存在 —— 跑 npm run fonts 生成`);
  }
  return hits;
}

/* ── C3 引用了不存在的 CSS 变量 ────────────────────────────────────
   踩过的坑：`.q-proj__name` 写了 `font-size: var(--text-h3)`，而本项目根本没有
   `--text-h3` 这个 token —— **font-size 静默回落到继承值**，卡片标题变成 16px。
   看起来「就是有点小」，完全联想不到是变量名写错，靠肉眼永远查不出来。

   判据收得很紧，只报「既没有 fallback、也确实没被定义过」的：
     · `var(--x, 0)` 有 fallback → 放过（大量运行时变量走这种写法）
     · 同文件里 `--x:` 定义过 → 放过（组件内部变量，如 --mx/--rx）
     · tokens.css 的 @theme 里定义过 → 放过
   宁可漏报，也不要制造一堆噪音 —— 噪音会让人关掉这个检查。 */
function checkUnknownVars() {
  const dir = join(ROOT, 'styles');
  const files = readdirSync(dir).filter((n) => n.endsWith('.css'));
  const defined = new Set();
  const read = (n) => readFileSync(join(dir, n), 'utf8');

  // 全站定义过的变量（含 tokens.css 的 @theme）
  for (const n of files) {
    const src = read(n);
    for (const m of src.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  }
  // 运行时由 JS 写进去的（约定位在 styles 里以 fallback 形式出现，这里兜一层）
  const runtime = new Set(['--fx', '--fy', '--fs', '--emis-x', '--emis-y']);

  const hits = [];
  for (const n of files) {
    const src = read(n);
    // 去掉注释，避免把说明文字里的示例当成真实用法
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of code.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      const name = m[1];
      const hasFallback = m[2] === ',';
      if (hasFallback) continue;
      if (defined.has(name) || runtime.has(name)) continue;
      hits.push(`${n}：var(${name}) 没有定义，也没写 fallback`);
    }
  }
  return hits;
}

for (const [rule, hits] of [
  [{ id: 'C1', name: '样式层循环依赖' }, checkStyleGraph()],
  [{ id: 'C2', name: '生成物被手改' }, checkGenerated()],
  [{ id: 'C3', name: '引用了不存在的 CSS 变量' }, checkUnknownVars()],
]) {
  if (hits.length) {
    violations += hits.length;
    report.push({ rule, hits });
  }
}

for (const rule of RULES) {
  const hits = [];
  for (const f of files) {
    if (rule.only && !rule.only.includes(extname(f))) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // 跳过注释行（含块注释的续行），否则「别再写 max-w-4xl」这种说明会被误报
      const trimmed = line.trim();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*') ||
        // 行内 // 注释之后的都是说明文字
        /^\s*(\{?\/\*|\*)/.test(line) ||
        // 注释块内部的整行（以 * 或无代码的说明串开头）
        /^\s*[^*{};<>]*[，。：；、—]/.test(trimmed)
      ) {
        return;
      }
      if (rule.allow && rule.allow.test(line)) return;
      if (rule.re.test(line)) hits.push(`${f}:${i + 1}  ${trimmed.slice(0, 90)}`);
    });
  }
  if (hits.length) {
    violations += hits.length;
    report.push({ rule, hits });
  }
}

if (violations === 0) {
  console.log('✅ 样式纪律自查通过，未发现问题。');
  process.exit(0);
}

for (const { rule, hits } of report) {
  console.log(`\n❌ [${rule.id}] ${rule.name} —— ${hits.length} 处`);
  console.log(`   修法：${rule.fix ?? '见上方说明'}`);
  for (const h of hits.slice(0, 12)) console.log(`   · ${h}`);
  if (hits.length > 12) console.log(`   … 另有 ${hits.length - 12} 处`);
}

console.log(`\n合计 ${violations} 处违规。`);
process.exit(1);
