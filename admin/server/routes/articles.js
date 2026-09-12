// 文章 & 概览接口：读取 + **写入**（后台唯一的写入口）。
//
// 数据文件（src/data/*.json）的只读接口在 routes/data.js，两边路径不重叠。
// 全部要求登录；写操作还要过 index.js 里的 Origin 校验。
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  allTags,
  changedFiles,
  createArticle,
  deleteArticle,
  listArticles,
  listTrash,
  purgeTrash,
  readArticle,
  restoreTrash,
  slugify,
  updateArticle,
} from '../articles.js';
import { overview } from '../overview.js';

const router = Router();
router.use(requireAuth);

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ——— 概览 ———
router.get('/overview', wrap(async (req, res) => res.json(await overview())));

// ——— 文章 ———
router.get(
  '/articles',
  wrap(async (req, res) => {
    const [articles, files] = await Promise.all([listArticles(), changedFiles()]);
    res.json({
      articles,
      unpublished: { count: files ? files.length : null, files: files ?? [] },
    });
  }),
);

router.get('/articles/:id', wrap(async (req, res) => res.json(await readArticle(req.params.id))));

router.post(
  '/articles',
  wrap(async (req, res) => {
    const article = await createArticle(req.body ?? {});
    res.status(201).json({ ok: true, article });
  }),
);

router.put(
  '/articles/:id',
  wrap(async (req, res) => {
    const article = await updateArticle(req.params.id, req.body ?? {});
    res.json({ ok: true, article });
  }),
);

router.post(
  '/articles/:id/delete',
  wrap(async (req, res) => res.json(await deleteArticle(req.params.id))),
);

// ——— 编辑器要的辅助数据 ———
/** 历史标签（自动补全用）*/
router.get('/tags', wrap(async (req, res) => res.json({ tags: await allTags() })));

/** 标题 → slug 预览（拼音在服务端算，前端不用装拼音库）*/
router.get(
  '/slug',
  wrap(async (req, res) => {
    res.json({
      slug: slugify(String(req.query.title ?? ''), String(req.query.date ?? '')),
    });
  }),
);

// ——— 回收站 ———
router.get('/trash', wrap(async (req, res) => res.json({ items: await listTrash() })));

router.post(
  '/trash/:entry/restore',
  wrap(async (req, res) => res.json(await restoreTrash(req.params.entry))),
);

router.post(
  '/trash/:entry/purge',
  wrap(async (req, res) => res.json(await purgeTrash(req.params.entry))),
);

export default router;
