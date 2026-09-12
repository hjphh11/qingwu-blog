// 数据接口（阶段 D 全部**只读**）。
// 一律要求登录；读取范围受 server/data.js 的白名单限制。
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { dataHealth, overview, rawData, readArticles, readData } from '../data.js';

const router = Router();

// 这一层之后的所有接口都要登录
router.use(requireAuth);

/** 统一包一层，异常交给全局错误处理 */
const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 数据总览：文章统计 + 各数据文件健康 + 最近文章 */
router.get('/overview', wrap(async (req, res) => res.json(await overview())));

/** 各数据文件健康（单独一个接口，概览页可单独刷新） */
router.get('/health/data', wrap(async (req, res) => res.json(await dataHealth())));

/** 文章列表（含草稿；带 frontmatter 摘要与统计） */
router.get('/articles', wrap(async (req, res) => res.json(await readArticles())));

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
