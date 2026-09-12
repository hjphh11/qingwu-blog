// 文章读写 —— **后台唯一会写文件的地方**。
//
// 安全底线（方案第九节）：
//   1. 只写 `src/content/blog/*.md`：id 走严格正则 + 解析后的相对路径必须仍在文章目录内
//   2. frontmatter 写入前用 zod 校验，分类必须在 categories.json 里
//   3. 一律 **LF** 换行、**不带 BOM**（仓库现有文章就是 LF，避免整文件 diff 噪声）
//   4. **原子写**（写临时文件再 rename），失败不留半个文件
//   5. 删除走**回收站**（软删除），文件不会真丢
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import pinyinPkg from 'pinyin';
import { z } from 'zod';
import { config } from './config.js';
import { readData } from './data.js';

// pinyin 是 CJS 包：ESM 默认导入拿到的是**模块对象**而不是函数，
// 直接调用会 TypeError。这里把各种互操作情况都兼容掉。
const pinyin = pinyinPkg.pinyin ?? pinyinPkg.default ?? pinyinPkg;

const BLOG_DIR = () => path.join(config.repoPath, 'src', 'content', 'blog');
const TRASH_DIR = () => config.trashPath;

/** 文章 id：小写字母/数字开头，只含小写字母数字和 . _ - */
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,120}$/;

function badRequest(message, code = 'bad_request') {
  const e = new Error(message);
  e.status = 400;
  e.code = code;
  e.expose = true;
  return e;
}
function notFound(message = '找不到这篇文章') {
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

/** 把 id 变成绝对路径，并**再次**确认没越界 */
function articlePath(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw badRequest('文章 id 不合法');
  const dir = BLOG_DIR();
  const full = path.join(dir, `${id}.md`);
  const rel = path.relative(dir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw badRequest('文章路径越界');
  }
  return full;
}

// ——— 输入校验（与 src/content.config.ts 的 schema 对齐）———
export const ArticleInput = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(120, '标题最多 120 字'),
  slug: z.string().trim().min(1, '地址不能为空').max(120),
  category: z.string().trim().min(1, '请选择分类'),
  pubDate: z.string().trim().min(1, '请填发布日期'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20, '最多 20 个标签').default([]),
  description: z.string().default(''),
  draft: z.boolean().default(false),
  pinned: z.boolean().default(false),
  pinOrder: z.number().int().min(0).max(9999).optional(),
  body: z.string().default(''),
});

/** 分类必须已存在 */
async function assertCategory(id) {
  const { categories } = await readData('categories.json');
  if (!categories.some((c) => c.id === id)) {
    throw badRequest(`分类「${id}」不在 categories.json 里，请先在「分类」模块添加`, 'unknown_category');
  }
}

/** 日期统一成 YYYY-MM-DD（文件里就是这么写的） */
function normalizeDate(input) {
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw badRequest('发布日期格式不对，请用 2026-09-12 这样的写法');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 把 frontmatter 里的日期转成 YYYY-MM-DD。
 *  ⚠️ js-yaml 会把**不带引号**的日期直接解析成 Date 对象，所以不能只按字符串处理。
 *  用 toISOString 取日期部分（YAML 的日期按 UTC 解析，这样不会因时区串天）。*/
function toDateText(v) {
  if (!v) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/**
 * 中文标题 → 拼音 slug（方案 §4.2）
 *   「清吾的博客」+ 2026-08-30 → `2026-08-30-qingwu-de-bo-ke`
 */
export function slugify(title, dateStr) {
  let arr = [];
  try {
    arr = pinyin(String(title ?? ''), { style: 'normal' }); // [['qing'],['wu']...]
  } catch {
    arr = [];
  }
  const words = (Array.isArray(arr) ? arr.flat().join('') : String(arr ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const base = words || 'post';
  const d = String(dateStr ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}-${base}` : base;
}

/** 正文摘成纯文本（用于自动摘要，约 80 字）*/
function plainText(md) {
  return String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    // 分隔线：整行**只有**三个以上同样的 - * _ 才算（可以夹空格）。
    // ⚠️ 不能写成 `^\s*([-*_])\s*\1\s*\1[\s\S]*?$` —— 那会把 `***粗斜体***`
    // 这种以三个星号开头的正文整行吃掉，自动摘要就空了（2026-09-12 实测踩到）。
    .replace(/^[ \t]*([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeExcerpt(body, n = 80) {
  const t = plainText(body);
  if (t.length <= n) return t;
  return `${t.slice(0, n).trimEnd()}…`;
}

// ——— frontmatter 序列化：**手写**，为的是和现有文章的写法一模一样 ———
//   title: "标题"          （字符串一律双引号）
//   pubDate: 2026-09-11    （日期不加引号）
//   tags: ["a", "b"]       （行内数组）
//   draft/pinned 只在非默认值时才写，pinOrder 只在置顶且有值时写
function yamlString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

export function serializeArticle(data, body) {
  const lines = ['---'];
  lines.push(`title: ${yamlString(data.title)}`);
  if (data.description) lines.push(`description: ${yamlString(data.description)}`);
  lines.push(`pubDate: ${data.pubDate}`);
  lines.push(`category: ${data.category}`);
  lines.push(`tags: [${(data.tags ?? []).map(yamlString).join(', ')}]`);
  if (data.draft) lines.push('draft: true');
  if (data.pinned) lines.push('pinned: true');
  if (data.pinned && typeof data.pinOrder === 'number') lines.push(`pinOrder: ${data.pinOrder}`);
  lines.push('---');

  const text = String(body ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\n+/, '');
  return `${lines.join('\n')}\n\n${text.replace(/\s*$/, '')}\n`;
}

/** 原子写：临时文件 + rename，且强制 LF、不带 BOM */
async function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content.replace(/\r\n/g, '\n'), { encoding: 'utf8' });
  await fs.rename(tmp, file);
}

// ——— 读 ———
export async function listArticles() {
  const dir = BLOG_DIR();
  let files;
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    const full = path.join(dir, file);
    const [st, text] = await Promise.all([fs.stat(full), fs.readFile(full, 'utf8')]);
    const id = file.replace(/\.md$/, '');
    let fm = {};
    let body = '';
    let error = null;
    try {
      const parsed = matter(text);
      fm = parsed.data ?? {};
      body = parsed.content ?? '';
    } catch (e) {
      error = `frontmatter 解析失败：${e.message}`;
    }
    out.push({
      id,
      error,
      title: fm.title ?? '(无标题)',
      description: fm.description ?? '',
      category: fm.category ?? '',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      draft: fm.draft === true,
      pinned: fm.pinned === true,
      pinOrder: typeof fm.pinOrder === 'number' ? fm.pinOrder : null,
      pubDate: fm.pubDate ? new Date(fm.pubDate).toISOString() : null,
      pubDateText: toDateText(fm.pubDate),
      mtime: st.mtime.toISOString(),
      bytes: st.size,
      chars: body.replace(/\s/g, '').length,
    });
  }
  return out;
}

export async function readArticle(id) {
  const file = articlePath(id);
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    throw notFound();
  }
  const st = await fs.stat(file);
  const parsed = matter(text);
  const fm = parsed.data ?? {};
  return {
    id,
    title: fm.title ?? '',
    description: fm.description ?? '',
    category: fm.category ?? '',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    draft: fm.draft === true,
    pinned: fm.pinned === true,
    pinOrder: typeof fm.pinOrder === 'number' ? fm.pinOrder : null,
    pubDateText: toDateText(fm.pubDate),
    body: parsed.content ?? '',
    mtime: st.mtime.toISOString(),
    raw: text,
  };
}

// ——— 回收站 ———
const TRASH_ENTRY_RE = /^[a-z]+--[a-z0-9._-]+--[0-9TZ:.-]+\.json$/;

function trashEntryPath(entry) {
  if (typeof entry !== 'string' || !TRASH_ENTRY_RE.test(entry)) throw badRequest('回收站条目名不合法');
  const dir = TRASH_DIR();
  const full = path.join(dir, entry);
  const rel = path.relative(dir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw badRequest('回收站路径越界');
  }
  return full;
}

async function putToTrash({ type, id, originalPath, data, body, note }) {
  await fs.mkdir(TRASH_DIR(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const entry = `${type}--${id}--${stamp}.json`;
  const payload = {
    type,
    id,
    originalPath,
    deletedAt: new Date().toISOString(),
    note: note ?? '',
    data,
    body,
  };
  await fs.writeFile(trashEntryPath(entry), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return entry;
}

export async function listTrash() {
  const dir = TRASH_DIR();
  let files;
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const obj = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      out.push({
        entry: f,
        type: obj.type,
        id: obj.id,
        title: obj.data?.title ?? obj.id,
        category: obj.data?.category ?? '',
        note: obj.note ?? '',
        deletedAt: obj.deletedAt,
        bytes: Buffer.byteLength(JSON.stringify(obj.body ?? ''), 'utf8'),
      });
    } catch {
      /* 坏条目直接跳过 */
    }
  }
  out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return out;
}

// ——— 写：新建 / 更新 / 软删除 ———
async function prepare(input) {
  const parsed = ArticleInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(`${first.path.join('.') || '(根)'}：${first.message}`, 'validation');
  }
  const v = parsed.data;
  await assertCategory(v.category);

  if (!ID_RE.test(v.slug)) {
    throw badRequest('文章地址只能用小写字母、数字和 -（不要空格、中文、斜杠）', 'bad_slug');
  }
  const pubDate = normalizeDate(v.pubDate);
  // 摘要留空 → 自动取正文开头约 80 字（方案 §4.2）
  const description = v.description.trim() || makeExcerpt(v.body);
  const tags = [...new Set(v.tags.map((t) => t.trim()).filter(Boolean))];

  const data = {
    title: v.title.trim(),
    description,
    pubDate,
    category: v.category,
    tags,
    draft: v.draft,
    pinned: v.pinned,
    ...(v.pinned && typeof v.pinOrder === 'number' ? { pinOrder: v.pinOrder } : {}),
  };
  return { data, body: v.body, slug: v.slug };
}

export async function createArticle(input) {
  const { data, body, slug } = await prepare(input);
  const file = articlePath(slug);
  try {
    await fs.access(file);
    throw conflict(`已经有一篇文章叫 ${slug} 了，换个地址或直接去编辑它`);
  } catch (e) {
    if (e.status) throw e;
    /* 不存在才是我们要的 */
  }
  await writeAtomic(file, serializeArticle(data, body));
  return readArticle(slug);
}

export async function updateArticle(id, input) {
  const oldFile = articlePath(id);
  try {
    await fs.access(oldFile);
  } catch {
    throw notFound();
  }
  const { data, body, slug } = await prepare(input);
  const newFile = articlePath(slug);

  if (slug !== id) {
    // 改了地址 = 换文件：先确认新名字没被占，再把老文件收进回收站（可恢复）
    try {
      await fs.access(newFile);
      throw conflict(`已经有一篇文章叫 ${slug} 了，换个地址`);
    } catch (e) {
      if (e.status) throw e;
    }
  }

  await writeAtomic(newFile, serializeArticle(data, body));

  if (slug !== id) {
    const old = matter(await fs.readFile(oldFile, 'utf8'));
    await putToTrash({
      type: 'article',
      id,
      originalPath: `src/content/blog/${id}.md`,
      data: old.data ?? {},
      body: old.content ?? '',
      note: `改地址：${id} → ${slug}（旧文件留存）`,
    });
    await fs.rm(oldFile, { force: true });
  }
  return readArticle(slug);
}

/**
 * **只改 frontmatter 里的 `category` 一行**，正文与其它字段逐字节不动。
 * 给「删除分类时批量迁移文章」用 —— 比走 updateArticle 全量重写安全得多
 * （全量重写会把没识别的 frontmatter 字段丢掉，也会让 diff 变大）。
 */
export async function patchArticleCategory(id, category) {
  const file = articlePath(id);
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    throw notFound();
  }
  if (!/^category:[ \t]*\S+/m.test(text)) {
    throw badRequest(`文章 ${id} 的 frontmatter 里没有 category 行，无法迁移`);
  }
  if (!/^category:[^\n]*$/m.test(text)) {
    throw badRequest(`文章 ${id} 的 category 行格式异常，无法安全迁移`);
  }
  const next = text.replace(/^category:[^\n]*$/m, `category: ${category}`);
  await writeAtomic(file, next);
  return { id, category };
}

export async function deleteArticle(id) {
  const file = articlePath(id);
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    throw notFound();
  }
  const parsed = matter(text);
  const fm = parsed.data ?? {};
  const entry = await putToTrash({
    type: 'article',
    id,
    originalPath: `src/content/blog/${id}.md`,
    data: {
      title: fm.title ?? id,
      description: fm.description ?? '',
      pubDate: toDateText(fm.pubDate),
      category: fm.category ?? '',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      draft: fm.draft === true,
      pinned: fm.pinned === true,
      ...(typeof fm.pinOrder === 'number' ? { pinOrder: fm.pinOrder } : {}),
    },
    body: parsed.content ?? '',
  });
  await fs.rm(file, { force: true });
  return { ok: true, entry, id };
}

/** 从回收站恢复：写回原路径（已存在同名则拒绝）*/
export async function restoreTrash(entry) {
  const file = trashEntryPath(entry);
  let obj;
  try {
    obj = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    throw notFound('回收站里没有这一条');
  }
  if (obj.type !== 'article') throw badRequest('目前只支持恢复文章');

  const target = articlePath(obj.id);
  try {
    await fs.access(target);
    throw conflict(`文章 ${obj.id} 已经存在了，先把现有的改名或删掉再恢复`);
  } catch (e) {
    if (e.status) throw e;
  }
  await writeAtomic(target, serializeArticle(obj.data, obj.body));
  await fs.rm(file, { force: true });
  return { ok: true, id: obj.id };
}

/** 彻底清除（不可恢复）*/
export async function purgeTrash(entry) {
  const file = trashEntryPath(entry);
  try {
    await fs.access(file);
  } catch {
    throw notFound('回收站里没有这一条');
  }
  await fs.rm(file, { force: true });
  return { ok: true };
}

// ——— 辅助：所有历史标签（给自动补全用）———
export async function allTags() {
  const arts = await listArticles();
  const count = new Map();
  for (const a of arts) for (const t of a.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

/**
 * 未发布的改动（保存了但还没提交到 git）—— 只读，不碰仓库。
 *
 * 返回 `[{ file, kind, code, renamedFrom }]`，kind 是 added / modified / deleted / renamed。
 *
 * ⚠️ 用 `git diff HEAD`（**按内容比**）而不是 `git status --porcelain`：
 * 后台一律写 LF（方案 §3.3），而 Windows 上 `core.autocrlf=true` 会让 git 觉得
 * 「工作区应该是 CRLF」，于是把 EOL 不同、**内容完全相同**的文件也报成 M。
 * `git diff HEAD` 会做换行归一化，这种假改动不会出现。
 * 新增文件 git diff 看不到，另用 `ls-files --others` 补上。
 */
export function changedFiles() {
  const base = ['-C', config.repoPath, '-c', 'core.quotePath=false'];
  const scope = ['--', 'src/content', 'src/data'];

  const runGit = (args) =>
    new Promise((resolve) => {
      execFile('git', [...base, ...args], { timeout: 8000 }, (err, stdout) => {
        resolve(err ? null : String(stdout));
      });
    });

  return (async () => {
    const [diffOut, otherOut] = await Promise.all([
      runGit(['diff', 'HEAD', '--name-status', ...scope]),
      runGit(['ls-files', '--others', '--exclude-standard', ...scope]),
    ]);
    if (diffOut === null || otherOut === null) return null;

    const rows = [];
    for (const line of diffOut.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const code = parts[0];
      if (code.startsWith('R')) {
        rows.push({ file: parts[2], kind: 'renamed', code, renamedFrom: parts[1] });
      } else {
        const kind = code.startsWith('A')
          ? 'added'
          : code.startsWith('D')
            ? 'deleted'
            : 'modified';
        rows.push({ file: parts[1], kind, code, renamedFrom: null });
      }
    }
    for (const line of otherOut.split('\n')) {
      const f = line.trim();
      if (f) rows.push({ file: f, kind: 'added', code: '??', renamedFrom: null });
    }
    return rows;
  })();
}

/** 未发布的改动数（兼容旧调用）*/
export async function changedCount() {
  const rows = await changedFiles();
  return rows ? rows.length : null;
}
