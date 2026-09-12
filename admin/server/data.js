// 读取博客仓库里的内容数据（阶段 D **只读**）。
//
// 原则（方案第九节）：后台**只能碰白名单里的内容文件**，读不到代码、也写不了任何东西。
//   · 白名单：src/data/*.json、src/content/blog/*.md、（以后）public/music/lrc/*.lrc
// 每个文件都用 zod 校验一遍 —— 这样概览页能直接告诉你"哪个数据文件写坏了、坏在哪"，
// 而不是等站点构建失败了才发现。
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import { config } from './config.js';

const repoPath = (...seg) => path.join(config.repoPath, ...seg);
const BLOG_DIR = () => repoPath('src', 'content', 'blog');

// ——— 校验用的 schema（结构与博客侧 src/data/*.ts 的 zod 校验保持一致，那边是权威）———
const urlLike = z.string().min(1);

const SCHEMAS = {
  'links.json': z.object({
    friends: z.array(
      z.object({ name: z.string().min(1), avatar: urlLike, intro: z.string(), url: urlLike }),
    ),
  }),
  'share.json': z.object({
    shares: z.array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('link'),
          id: z.string().min(1),
          title: z.string(),
          url: urlLike,
          note: z.string(),
        }),
        z.object({
          type: z.literal('quote'),
          id: z.string().min(1),
          text: z.string(),
          author: z.string().optional(),
        }),
      ]),
    ),
  }),
  'about.json': z.object({
    profile: z.object({
      name: z.string().min(1),
      tagline: z.string(),
      whyName: z.string(),
      whyBlog: z.string(),
      whatWrite: z.string(),
    }),
    info: z.array(z.object({ icon: z.string(), label: z.string(), value: z.string() })),
    emis: z.object({ img: urlLike, persona: z.array(z.string()) }),
  }),
  'music.json': z.object({
    songs: z.array(
      z.object({
        id: z.number().int(),
        title: z.string().min(1),
        artist: z.string(),
        cover: urlLike,
        audio: urlLike,
        note: z.string().optional(),
        lrc: z.string().optional(),
      }),
    ),
  }),
  'categories.json': z.object({
    categories: z.array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        label: z.string().min(1),
        order: z.number().int(),
        icon: z.string().optional(),
      }),
    ),
  }),
};

/** 每个文件在概览里怎么数条目、怎么给额外摘要 */
const SUMMARIES = {
  'links.json': { label: '友链', count: (d) => d.friends.length },
  'share.json': {
    label: '分享 / 语录',
    count: (d) => d.shares.length,
    extra: (d) => ({
      收藏: d.shares.filter((s) => s.type === 'link').length,
      语录: d.shares.filter((s) => s.type === 'quote').length,
    }),
  },
  'about.json': { label: '关于页', count: (d) => d.info.length, unit: '条信息' },
  'music.json': { label: '音乐', count: (d) => d.songs.length, unit: '首' },
  'categories.json': { label: '分类', count: (d) => d.categories.length, unit: '个' },
};

async function statOrNull(file) {
  try {
    const s = await fs.stat(file);
    return { bytes: s.size, mtime: s.mtime.toISOString() };
  } catch {
    return null;
  }
}

/** 读一个白名单 JSON 文件并校验，返回健康状态 */
async function readOne(name) {
  const file = repoPath('src', 'data', name);
  const summary = SUMMARIES[name] ?? { label: name, count: () => 0 };
  const st = await statOrNull(file);
  if (!st) {
    return { file: name, label: summary.label, ok: false, error: '文件不存在', ...st };
  }
  let data;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    return { file: name, label: summary.label, ok: false, error: `不是合法 JSON：${err.message}`, ...st };
  }
  const parsed = SCHEMAS[name].safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.length ? first.path.join('.') : '(根)';
    return {
      file: name,
      label: summary.label,
      ok: false,
      error: `结构不对：${where} —— ${first.message}`,
      ...st,
    };
  }
  return {
    file: name,
    label: summary.label,
    ok: true,
    count: summary.count(parsed.data),
    unit: summary.unit ?? '项',
    extra: summary.extra?.(parsed.data),
    ...st,
  };
}

/** 概览用：所有数据文件的健康状态 */
export async function dataHealth() {
  return Promise.all(Object.keys(SCHEMAS).map(readOne));
}

/** 白名单校验失败：这是**客户端的错**，不该打整条堆栈 */
function notAllowed() {
  const err = new Error('这个文件不在后台的白名单里（只允许 src/data 下那几个数据文件）');
  err.status = 400;
  err.code = 'not_allowed';
  err.expose = true;
  return err;
}

/** 原始 JSON 文本（给概览页的「原始 JSON 预览」用；只允许白名单文件） */
export async function rawData(name) {
  if (!Object.hasOwn(SCHEMAS, name)) throw notAllowed();
  const file = repoPath('src', 'data', name);
  return { name, text: await fs.readFile(file, 'utf8') };
}

/** 只返回白名单数据文件的解析结果（含数据本体，供各模块用） */
export async function readData(name) {
  if (!Object.hasOwn(SCHEMAS, name)) throw notAllowed();
  const text = await fs.readFile(repoPath('src', 'data', name), 'utf8');
  return SCHEMAS[name].parse(JSON.parse(text));
}

/** 文章列表：解析 frontmatter，返回概览与列表需要的字段 */
export async function readArticles() {
  const dir = BLOG_DIR();
  let files;
  try {
    files = (await fs.readdir(dir)).filter((f) => /\.(md|mdx)$/.test(f));
  } catch {
    return { ok: false, error: `读不到文章目录：${dir}`, articles: [] };
  }

  const articles = [];
  for (const file of files) {
    const full = path.join(dir, file);
    const [st, text] = await Promise.all([
      fs.stat(full),
      fs.readFile(full, 'utf8'),
    ]);
    let fm = {};
    let body = text;
    try {
      const parsed = matter(text);
      fm = parsed.data ?? {};
      body = parsed.content ?? '';
    } catch (err) {
      articles.push({
        id: file.replace(/\.(md|mdx)$/, ''),
        file,
        error: `frontmatter 解析失败：${err.message}`,
        mtime: st.mtime.toISOString(),
      });
      continue;
    }
    const chars = body.replace(/\s/g, '').length;
    articles.push({
      id: file.replace(/\.(md|mdx)$/, ''),
      file,
      title: fm.title ?? '(无标题)',
      description: fm.description ?? '',
      category: fm.category ?? '',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      draft: fm.draft === true,
      pinned: fm.pinned === true,
      pubDate: fm.pubDate ? new Date(fm.pubDate).toISOString() : null,
      mtime: st.mtime.toISOString(),
      chars,
      readMinutes: Math.max(1, Math.round(chars / 400)),
      bytes: st.size,
    });
  }

  articles.sort((a, b) => String(b.pubDate ?? b.mtime).localeCompare(String(a.pubDate ?? a.mtime)));
  return { ok: true, dir, articles };
}

/** 数据总览：文章统计 + 各数据文件健康 + 仓库信息 */
export async function overview() {
  const [health, blog] = await Promise.all([dataHealth(), readArticles()]);
  const arts = blog.articles ?? [];
  const byCategory = {};
  for (const a of arts) {
    if (!a.category) continue;
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
  }
  const cats = await readData('categories.json').catch(() => ({ categories: [] }));
  const labelOf = Object.fromEntries(cats.categories.map((c) => [c.id, c.label]));

  return {
    repo: {
      path: config.repoPath,
      articlesDir: blog.dir ?? null,
      articlesOk: blog.ok === true,
      articlesError: blog.ok ? null : blog.error,
    },
    articles: {
      total: arts.length,
      published: arts.filter((a) => !a.draft).length,
      drafts: arts.filter((a) => a.draft).length,
      pinned: arts.filter((a) => a.pinned).length,
      broken: arts.filter((a) => a.error).length,
      totalChars: arts.reduce((n, a) => n + (a.chars ?? 0), 0),
      byCategory: Object.entries(byCategory).map(([id, n]) => ({
        id,
        label: labelOf[id] ?? id,
        count: n,
      })),
      recent: arts.slice(0, 8).map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category,
        categoryLabel: labelOf[a.category] ?? a.category,
        pubDate: a.pubDate,
        draft: a.draft,
        pinned: a.pinned,
        mtime: a.mtime,
      })),
    },
    data: health,
    categories: cats.categories,
  };
}
