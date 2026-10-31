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
  console.log(`   修法：${rule.fix}`);
  for (const h of hits.slice(0, 12)) console.log(`   · ${h}`);
  if (hits.length > 12) console.log(`   … 另有 ${hits.length - 12} 处`);
}

console.log(`\n合计 ${violations} 处违规。`);
process.exit(1);
