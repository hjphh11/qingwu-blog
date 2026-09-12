// src/data/*.json 的**只读**接口（阶段 D 起就有）。
// 文章、概览与回收站在 routes/articles.js；这里路径不重叠，两边都挂在 /api 下。
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { dataHealth, rawData, readData } from '../data.js';

const router = Router();

// 这一层之后的所有接口都要登录
router.use(requireAuth);

/** 统一包一层，异常交给全局错误处理 */
const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 各数据文件健康（写坏了会指出是哪个文件、哪个字段）*/
router.get('/health/data', wrap(async (req, res) => res.json(await dataHealth())));

/** 白名单数据文件：解析后的内容 */
router.get(
  '/data/:name',
  wrap(async (req, res) => res.json(await readData(req.params.name))),
);

/** 白名单数据文件：原始 JSON 文本（给「原始 JSON 预览」用） */
router.get(
  '/data/:name/raw',
  wrap(async (req, res) => res.json(await rawData(req.params.name))),
);

export default router;
