// 把「二级 Python 刷题」单文件应用转换成博客可用的刷题页。
//
// 做什么：
//   1) 剥掉内嵌的 689 题题库（题库不进博客源码/仓库）；
//   2) 内置题库改为运行时从 /api/questions 获取（服务端函数代取私有仓库）；
//   3) 保留「导入题库 / 恢复内置」——即「自带题库 / 我的题库」切换；
//   4) 配色换成清吾的爱弥斯暖色（覆盖 CSS 变量），并隐藏深浅切换（博客只做暖色）。
//
// 用法：
//   node scripts/build-quiz.mjs
//   QUIZ_SRC="D:\path\to\index.html" node scripts/build-quiz.mjs
//
// 源文件是本地那份「带全量题库」的 index.html；输出到 public/quiz/index.html。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SRC = process.env.QUIZ_SRC || 'D:\\zm\\随机抽题\\index.html';
const OUT = resolve('public/quiz/index.html');

let html = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

/** 断言式替换：必须恰好命中一次，否则报错（避免静默改错）。 */
function replaceOnce(pattern, replacement, label) {
  const re = pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g') : null;
  const matches = html.match(re);
  if (!matches || matches.length !== 1) {
    throw new Error(`[build-quiz] 期望命中 1 次但命中 ${matches ? matches.length : 0} 次：${label}`);
  }
  html = html.replace(re, replacement);
}

// 1) 剥掉内嵌题库
replaceOnce(
  /<!--BANK-START-->[\s\S]*?<!--BANK-END-->/,
  '<!-- 题库不内嵌于页面：运行时从 /api/questions 获取（见下方脚本）。 -->',
  'remove embedded bank',
);

// 2) 内置题库改为从服务端函数获取；获取完成后再启动应用
replaceOnce(
  /<script>\s*\/\* 题库以纯 JSON 内嵌[\s\S]*?<\/script>/,
  `<script>
/* 题库不放在页面里：运行时从 /api/questions（服务端函数，代取私有仓库）获取。
   「自带题库」= 服务端返回的题库；「我的题库」= 你在本页导入、存在 localStorage 的题库。 */
(function () {
  function boot(bank) {
    window.BUILTIN_BANK = bank;
    window.QUESTION_BANK = bank;
    try {
      var saved = JSON.parse(localStorage.getItem('pyquiz.bank.v1') || 'null');
      if (Array.isArray(saved) && saved.length) window.QUESTION_BANK = saved;
    } catch (e) { /* 忽略损坏的本地题库，回退到自带题库 */ }
    if (typeof window.__pyquizBoot === 'function') window.__pyquizBoot();
  }
  fetch('/api/questions', { headers: { accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { boot(Array.isArray(data) ? data : []); })
    .catch(function (err) {
      console.error('[quiz] 题库获取失败:', err);
      boot([]);
    });
})();
</script>`,
  'replace bank bootstrap',
);

// 3) 应用主逻辑：从「立即执行」改为「题库就绪后执行」
replaceOnce(
  /\n\(function \(\) \{\n {2}'use strict';/,
  "\nwindow.__pyquizBoot = function () {\n  'use strict';",
  'defer app IIFE (start)',
);
replaceOnce(/\n\}\)\(\);\n<\/script>\n<\/body>/, '\n};\n</script>\n</body>', 'defer app IIFE (end)');

// 4) 题库加载失败的提示改为适配本页
replaceOnce(
  /未能加载题库。请确认 questions\.js 与 index\.html 位于同一目录。/,
  '未能加载题库。请稍后重试，或在「题库来源」导入自己的题库。',
  'error message',
);

// 5) 爱弥斯暖色：覆盖 CSS 变量（浅色/深色都覆盖，保证始终是暖色）+ 隐藏深浅切换
const warm = `
<style>
/* ===== 清吾 · 爱弥斯暖色主题覆盖（覆盖原冷色变量，浅/深统一为暖色） ===== */
:root[data-theme="light"],
:root[data-theme="dark"] {
  --bg: #fdf6f0;
  --bg-deep: #f7ece4;
  --surface: #fffdfb;
  --surface-2: #fbf1ea;
  --surface-3: #f6e8e0;

  --text: #4a3728;
  --text-2: #6b5443;
  --text-3: #8a7360;

  --border: #f0dcd2;
  --border-strong: #e3c4b8;

  --primary: #e0526b;
  --primary-hover: #cf4760;
  --primary-ink: #e0526b;
  --primary-soft: #fbe4e9;
  --on-primary: #ffffff;
  --ring: #e0526b;

  --ok: #2f855a;
  --ok-strong: #276749;
  --ok-bg: #e8f5ee;
  --ok-border: #a8d5bd;

  --bad: #c0392b;
  --bad-strong: #d64541;
  --bad-bg: #fdeceb;
  --bad-border: #f0b3ad;

  --flag: #a9772a;
  --flag-bg: #fdf6e3;
  --flag-border: #e8cd8a;

  --brand-1: #e0526b;
  --brand-2: #e8b04b;

  --sh-1: 0 1px 2px rgba(74, 55, 40, .05);
  --sh-2: 0 4px 14px -6px rgba(74, 55, 40, .12), 0 1px 2px rgba(74, 55, 40, .05);
  --sh-3: 0 18px 44px -20px rgba(74, 55, 40, .25), 0 2px 6px rgba(74, 55, 40, .05);
  --sh-focus: 0 0 0 3px rgba(224, 82, 107, .22);

  --art-card: #fffdfb;
  --art-bar: #f0dcd2;
  --art-bar-lg: #e3c4b8;
  --art-opt: #fbf1ea;
  --art-opt-on: #fbe4e9;
  --art-opt-dot: #e3c4b8;
  --art-ring-bg: #fbf1ea;

  color-scheme: light;
}

/* 博客只做暖色，隐藏深浅切换按钮 */
#btnTheme { display: none !important; }
</style>
</head>`;
replaceOnce(/<\/head>/, warm, 'inject warm theme');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`[build-quiz] 已生成 ${OUT} (${kb} KB) —— 不含任何题目`);
