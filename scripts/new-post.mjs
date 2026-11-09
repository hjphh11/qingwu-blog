#!/usr/bin/env node
/**
 * 新文章脚手架 —— `npm run new:post -- "文章标题" [slug] [分类]`
 *
 * 为什么要它：每写一篇都要手抄一遍 frontmatter，字段名、日期格式、分类 id
 * 记错一个，构建就会在 schema 校验那儿报错，回来改一遍才能继续写。
 * 这个脚本把「能确定的部分」先填好，人只负责写正文。
 *
 * 三条刻意的克制：
 *   1. **不自动翻译 slug**。中文标题硬转拼音要么引依赖、要么转得莫名其妙，
 *      不如让作者自己给一个能读的英文短名；不给就用日期兜底，之后再改文件名也不影响。
 *   2. **不覆盖已有文件**。同名就报错退出，宁可让人换个名字，也不能吞掉正在写的稿。
 *   3. **draft 默认 true**。草稿不会被构建进页面，写完确认了再手动翻成 false。
 *
 * 分类以 `src/data/categories.json` 为准（和前台筛选、schema 校验同一份表）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOG_DIR = join(ROOT, 'src/content/blog');
const CATEGORY_FILE = join(ROOT, 'src/data/categories.json');

const args = process.argv.slice(2).filter((a) => a !== '--');
const title = (args[0] || '').trim();
const slugArg = (args[1] || '').trim();
const catArg = (args[2] || '').trim();

if (!title) {
  console.error('用法：npm run new:post -- "文章标题" [slug] [分类]');
  console.error('  例：npm run new:post -- "关于字体子集化" font-subset tech');
  process.exit(1);
}

/** 分类表：schema 的 refine 也是按这份表校验，写错这里会在构建时才炸 */
let categories = [];
try {
  categories = JSON.parse(readFileSync(CATEGORY_FILE, 'utf8')).categories ?? [];
} catch {
  console.warn('⚠️ 读不到 src/data/categories.json，分类将留空（记得手动填）');
}
const ids = categories.map((c) => c.id);

if (catArg && ids.length && !ids.includes(catArg)) {
  console.error(`未知分类「${catArg}」。可用：${ids.join(' / ')}`);
  process.exit(1);
}
const category = catArg || ids[0] || '';

/** slug 只留 a-z0-9-，中文会被清成空字符串 —— 那和没给一样，走日期兜底 */
const cleanSlug = slugArg
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const stamp = `${today.replace(/-/g, '')}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const slug = cleanSlug || `post-${stamp}`;
const file = join(BLOG_DIR, `${slug}.md`);

if (existsSync(file)) {
  console.error(`❌ 已经有一篇叫 ${slug}.md 了，换个 slug 再试（没有覆盖任何文件）`);
  process.exit(1);
}

/** 标题里有双引号会破坏 YAML —— 统一换成单引号，这是最容易踩的一个 */
const safeTitle = title.replace(/"/g, "'");

const body = `---
title: "${safeTitle}"
description: ""
pubDate: ${today}
category: ${category}
tags: []
draft: true
---

正文从这里开始写。

`;

writeFileSync(file, body, 'utf8');

// 顺手报一下现有篇数，写的时候心里有数
let total = 0;
try {
  total = readdirSync(BLOG_DIR).filter((f) => /\.(md|mdx)$/.test(f)).length;
} catch {
  /* 目录异常就不报了 */
}

console.log(`✅ 已创建 src/content/blog/${slug}.md`);
console.log(`   标题：${title}`);
console.log(`   分类：${category || '（未填，需要手动补，否则构建会报错）'}`);
console.log(`   状态：draft = true（写完改成 false 才会出现在页面上）`);
console.log(`   当前共 ${total} 篇文章`);
if (!cleanSlug && slugArg) {
  console.log(`   ⚠️ 「${slugArg}」里没有可用的英文字符，文件名用了日期占位，可以之后改；`);
  console.log(`      改文件名不影响 URL —— 路由是按 frontmatter 和 slug 规则生成的，记得同步。`);
}
