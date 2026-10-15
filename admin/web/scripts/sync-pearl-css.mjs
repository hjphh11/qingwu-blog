// 把 scaffold 的「珍珠玻璃」七层样式搬进本后台，并做**最小改名**以隔离冲突。
//
// 为什么要有这个脚本：
//   1. 那 152KB CSS 是 scaffold 的成熟成果，逐字复用比手抄可靠；
//   2. 本后台已有一套暖色 app.css（19 个页面在用），两边有 25 个类名 + 2 个
//      自定义属性 + 1 个 keyframes 重名。只给**重名的那些**加 `p-` 前缀，
//      其余一字不改 —— 老页面不受伤，新外壳拿到原样的视觉；
//   3. scaffold 更新时重跑一次即可，改名规则写死在下面，不靠人记。
//
// 用法：
//   node admin/web/scripts/sync-pearl-css.mjs
//   SCAFFOLD_VUE_STYLES=<路径> node admin/web/scripts/sync-pearl-css.mjs
//
// 来源与许可：D:\zm\scaffold（MIT，Copyright (c) 2026 wbr664393425-lgtm）。
// 详见同目录生成的 README.md。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'src', 'styles', 'pearl');
const srcDir = process.env.SCAFFOLD_VUE_STYLES
  ?? 'D:\\zm\\scaffold\\scaffold-vue\\src\\styles';

/** 引入顺序即层叠顺序：令牌 → 基线 → 材质 → 控件 → 仪器 → 布局 → 页面差异 */
const FILES = ['tokens.css', 'base.css', 'materials.css', 'components.css', 'instruments.css', 'layout.css', 'pages.css'];

/** 与 app.css（暖色）重名的类名 → 加 `p-` 前缀。长的排前面，避免 btn-ghost 被 btn 先吃掉。 */
const CLASS_RENAMES = [
  'btn-block', 'btn-ghost', 'login-brand', 'login-card', 'panel-head', 'table-wrap',
  'brand-mark', 'form-grid', 'nav-item',
  'btn', 'content', 'empty', 'field', 'kbd', 'md', 'mono', 'pager', 'panel', 'preview',
  'spacer', 'spin', 'stage', 'table', 'tag', 'topbar',
];

/** 与 theme.css / app.css 重名的自定义属性 */
const VAR_RENAMES = [
  ['--line-strong', '--p-line-strong'],
  ['--line', '--p-line'],
];

/** 与 app.css 重名的 keyframes */
const KEYFRAME_RENAMES = [['spin', 'p-spin']];

function renameClasses(css) {
  let out = css;
  for (const name of CLASS_RENAMES) {
    // 只改类选择器：`.btn` / `.btn:hover` / `.a.btn` / `.btn.tag` 都命中，
    // `.btn-primary`、`.btnning` 不命中。
    out = out.replace(new RegExp(`\\.${name}(?![\\w-])`, 'g'), `.p-${name}`);
  }
  return out;
}

function renameVars(css) {
  let out = css;
  for (const [from, to] of VAR_RENAMES) {
    out = out.replace(new RegExp(`${from}(?![\\w-])`, 'g'), to);
  }
  return out;
}

function renameKeyframes(css) {
  let out = css;
  for (const [from, to] of KEYFRAME_RENAMES) {
    out = out.replace(new RegExp(`@keyframes\\s+${from}\\b`, 'g'), `@keyframes ${to}`);
    // animation / animation-name 简写里的引用
    out = out.replace(new RegExp(`(animation(?:-name)?\\s*:[^;}]*?)\\b${from}\\b`, 'g'), `$1${to}`);
  }
  return out;
}

/** scaffold 的挂载点是 #app，本后台是 #root —— 让同一套布局基线两边都成立 */
function fixMountPoint(css) {
  return css.replace(/(^|[,\s>+~])#app(?![\\w-])/g, '$1#app, #root');
}

const report = [];
if (!fs.existsSync(srcDir)) {
  console.error(`找不到 scaffold 样式目录：${srcDir}`);
  console.error('用 SCAFFOLD_VUE_STYLES=<路径> 指定。');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const src = path.join(srcDir, file);
  if (!fs.existsSync(src)) {
    console.error(`缺少源文件：${src}`);
    process.exit(1);
  }
  const before = fs.readFileSync(src, 'utf8');
  const after = fixMountPoint(renameKeyframes(renameVars(renameClasses(before))));
  fs.writeFileSync(path.join(outDir, file), after, 'utf8');
  report.push(`${file.padEnd(16)} ${String(before.length).padStart(7)} → ${String(after.length).padStart(7)} 字节`);
}

console.log(`源目录：${srcDir}`);
console.log(`输出：  ${outDir}`);
console.log(report.join('\n'));
console.log(`改名：${CLASS_RENAMES.length} 个类名、${VAR_RENAMES.length} 个自定义属性、${KEYFRAME_RENAMES.length} 个 keyframes`);
