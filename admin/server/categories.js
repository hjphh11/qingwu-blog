// 分类读写 —— categories.json 是**唯一数据源**：
// 后台在这里增删改排序，前台的 /blog 筛选按钮、文章 schema 校验都跟着自动变。
//
// 序列化**手写**，为了跟现有文件格式一模一样（一行一个分类、4 空格缩进），
// 避免每次保存都把整个 JSON 重排一遍（diff 噪声）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { listArticles, patchArticleCategory, slugify } from './articles.js';

const CATEGORIES_FILE = () => path.join(config.repoPath, 'src', 'data', 'categories.json');

/**
 * 可选图标名 —— 必须与 `src/lib/categoryIcons.ts` 的 ICON_MAP 保持一致。
 * 写了不认识的名字也没关系（前台会回落到默认图标），但后台只让选这几个。
 */
export const AVAILABLE_ICONS = ['sparkles', 'flower', 'book', 'music', 'laptop'];

function badRequest(message, code = 'bad_request') {
  const e = new Error(message);
  e.status = 400;
  e.code = code;
  e.expose = true;
  return e;
}
function notFound(message = '找不到这个分类') {
  const e = new Error(message);
  e.status = 404;
  e.code = 'not_found';
  e.expose = true;
  return e;
}
function conflict(message) {
  const e = new Error(message);
  e.status = 409;
  e.code = 'conflict';
  e.expose = true;
  return e;
}

/** 中文名 → 内部标识：直接用 slugify（拼音），纯英文名也会被规整成小写连字符 */
function makeIdBase(label) {
  const base = slugify(String(label ?? '').trim(), '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'cat';
}

/** 按现有文件格式序列化 */
function serialize(cats) {
  const lines = cats.map((c) => {
    const parts = [
      `"id": ${JSON.stringify(c.id)}`,
      `"label": ${JSON.stringify(c.label)}`,
      `"order": ${c.order}`,
    ];
    if (c.icon) parts.push(`"icon": ${JSON.stringify(c.icon)}`);
    return `    { ${parts.join(', ')} }`;
  });
  return `{\n  "categories": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

async function writeCategories(cats) {
  const file = CATEGORIES_FILE();
  // 换行沿用原文件（Windows 检出是 CRLF、Linux 是 LF；一律写 LF 会产生假 diff）
  let eol = '\n';
  try {
    const old = await fs.readFile(file, 'utf8');
    if (old.includes('\r\n')) eol = '\r\n';
  } catch {
    /* 新文件用 LF */
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, serialize(cats).replace(/\r?\n/g, eol), { encoding: 'utf8' });
  await fs.rename(tmp, file);
}

/** 读原始列表（不排序、不改 order），并做基本校验 */
async function readRaw() {
  let obj;
  try {
    obj = JSON.parse(await fs.readFile(CATEGORIES_FILE(), 'utf8'));
  } catch (err) {
    throw badRequest(`categories.json 读不了：${err.message}`, 'bad_categories_file');
  }
  if (!obj || !Array.isArray(obj.categories)) {
    throw badRequest('categories.json 结构不对：需要 { categories: [...] }', 'bad_categories_file');
  }
  for (const c of obj.categories) {
    if (!c || typeof c.id !== 'string' || typeof c.label !== 'string' || typeof c.order !== 'number') {
      throw badRequest('categories.json 里有分类缺 id/label/order', 'bad_categories_file');
    }
  }
  return obj.categories;
}

/** 每个分类下有几篇文章 —— 删分类时要用它做「归属保护」*/
export async function categoryCounts() {
  const arts = await listArticles();
  const m = {};
  for (const a of arts) {
    if (!a.category) continue;
    m[a.category] = (m[a.category] ?? 0) + 1;
  }
  return m;
}

/** 分类列表（按 order 排好，带文章数与可选图标清单）*/
export async function listCategories() {
  const [raw, counts] = await Promise.all([readRaw(), categoryCounts()]);
  const categories = [...raw]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((c) => ({ ...c, count: counts[c.id] ?? 0 }));
  return { categories, availableIcons: AVAILABLE_ICONS, total: categories.length };
}

function assertLabel(label) {
  const v = String(label ?? '').trim();
  if (!v) throw badRequest('分类名不能为空');
  if (v.length > 20) throw badRequest('分类名最多 20 个字');
  return v;
}

function assertIcon(icon) {
  if (icon === undefined || icon === null || icon === '') return undefined;
  const v = String(icon);
  if (!AVAILABLE_ICONS.includes(v)) {
    throw badRequest(`图标「${v}」不在可选范围里（${AVAILABLE_ICONS.join(' / ')}）`);
  }
  return v;
}

/** 新建：**只填中文名**，内部标识自动转拼音（方案 §4.3）*/
export async function createCategory({ label, icon }) {
  const name = assertLabel(label);
  const iconName = assertIcon(icon);
  const cats = await readRaw();

  // 名称不能重复
  if (cats.some((c) => c.label === name)) {
    throw conflict(`已经有叫「${name}」的分类了`);
  }

  // 生成 id（拼音），重名就加 -2 / -3
  const base = makeIdBase(name);
  let id = base;
  let n = 2;
  while (cats.some((c) => c.id === id)) id = `${base}-${n++}`;

  const order = cats.length === 0 ? 1 : Math.max(...cats.map((c) => c.order)) + 1;
  const next = [...cats, { id, label: name, order, ...(iconName ? { icon: iconName } : {}) }];
  await writeCategories(next);
  return { id, label: name, order, ...(iconName ? { icon: iconName } : {}), count: 0 };
}

/** 改名 / 换图标。**id 不给改**：它写在每篇文章的 frontmatter 里，
 *  改了要连带重写所有文章，风险大收益小 —— 想换标识就新建一个再把文章转过去。*/
export async function updateCategory(id, { label, icon }) {
  const name = assertLabel(label);
  const iconName = assertIcon(icon);
  const cats = await readRaw();
  const idx = cats.findIndex((c) => c.id === id);
  if (idx === -1) throw notFound();
  if (cats.some((c, i) => c.label === name && i !== idx)) {
    throw conflict(`已经有叫「${name}」的分类了`);
  }
  const next = [...cats];
  next[idx] = { id, label: name, order: cats[idx].order, ...(iconName ? { icon: iconName } : {}) };
  await writeCategories(next);
  return next[idx];
}

/** 排序：传一个按目标顺序排好的 id 数组，写回 order = 下标+1（决策 29：上下移动 + 保存）*/
export async function reorderCategories(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw badRequest('需要传 id 数组');
  const cats = await readRaw();
  const known = new Set(cats.map((c) => c.id));
  if (ids.length !== cats.length || ids.some((i) => !known.has(i)) || new Set(ids).size !== ids.length) {
    throw badRequest('排序 id 列表和现有分类对不上（数量或内容不一致），请刷新后重试');
  }
  const orderOf = new Map(ids.map((id, i) => [id, i + 1]));
  const next = cats.map((c) => ({ ...c, order: orderOf.get(c.id) }));
  await writeCategories(next);
  return listCategories();
}

/**
 * 删除分类。**有文章时必须给 moveTo**（方案 §4.3 的归属保护）：
 * 先把这些文章改成 moveTo 分类，再删分类。
 * 文章只改 frontmatter 里的 category 一行，正文与其它字段**逐字节不动**。
 */
export async function deleteCategory(id, moveTo) {
  const cats = await readRaw();
  const target = cats.find((c) => c.id === id);
  if (!target) throw notFound();

  const arts = await listArticles();
  const affected = arts.filter((a) => a.category === id);

  if (affected.length > 0) {
    if (!moveTo) {
      throw conflict(
        `「${target.label}」下面还有 ${affected.length} 篇文章，不能直接删。请先把它们转到别的分类。`,
      );
    }
    if (moveTo === id) throw badRequest('不能转移到自己');
    if (!cats.some((c) => c.id === moveTo)) throw badRequest('要转移到的分类不存在');
    for (const a of affected) await patchArticleCategory(a.id, moveTo);
  }

  const next = cats
    .filter((c) => c.id !== id)
    .map((c, i) => ({ ...c, order: i + 1 })); // 删完重排 order，避免留下空洞
  await writeCategories(next);

  return {
    ok: true,
    deleted: id,
    moved: affected.length,
    movedTo: affected.length > 0 ? moveTo : null,
    movedArticles: affected.map((a) => a.id),
  };
}
