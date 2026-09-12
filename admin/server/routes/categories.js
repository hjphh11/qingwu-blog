// 分类管理接口（方案 §4.3）。
// 写入唯一数据源 src/data/categories.json —— 前台的 /blog 筛选按钮与文章 schema 都跟着自动变。
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  createCategory,
  deleteCategory,
  listCategories,
  reorderCategories,
  updateCategory,
} from '../categories.js';

const router = Router();
router.use(requireAuth);

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 分类列表 + 每类的文章数 + 可选图标清单 */
router.get('/categories', wrap(async (req, res) => res.json(await listCategories())));

/** 新建（只填中文名，内部标识自动转拼音）*/
router.post(
  '/categories',
  wrap(async (req, res) => {
    const c = await createCategory(req.body ?? {});
    res.status(201).json({ ok: true, category: c });
  }),
);

/** 排序：传按目标顺序排好的 id 数组（决策 29：上下移动 + 保存）*/
router.post(
  '/categories/reorder',
  wrap(async (req, res) => {
    res.json({ ok: true, ...(await reorderCategories(req.body?.ids)) });
  }),
);

/** 改名 / 换图标（id 不可改 —— 它写在每篇文章的 frontmatter 里）*/
router.put(
  '/categories/:id',
  wrap(async (req, res) => {
    const c = await updateCategory(req.params.id, req.body ?? {});
    res.json({ ok: true, category: c });
  }),
);

/** 删除。有文章时必须带 moveTo（归属保护），会先把文章迁移过去 */
router.post(
  '/categories/:id/delete',
  wrap(async (req, res) => {
    res.json(await deleteCategory(req.params.id, req.body?.moveTo));
  }),
);

export default router;
