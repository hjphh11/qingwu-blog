// 发布与回滚接口（方案 §4.10）。
//
// 发布是**异步任务**：POST 立刻返回，前端轮询 /api/publish/status 看每一步。
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { currentJob, history, publishStatus, readLogs, startPublish, startRollback } from '../publish.js';

const router = Router();
router.use(requireAuth);

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 待发布文件 + 分支状态 + 最近提交 + 当前任务 */
router.get('/publish/status', wrap(async (req, res) => res.json(await publishStatus())));

/** 最近几次提交（供回滚选）*/
router.get('/publish/history', wrap(async (req, res) => res.json({ history: await history() })));

/** 操作日志（第 43 条）*/
router.get('/publish/log', wrap(async (req, res) => res.json({ items: await readLogs(Number(req.query.limit) || 50) })));

/** 开始发布：{ paths?: string[], mode?: 'all' | 'selected' } */
router.post(
  '/publish',
  wrap(async (req, res) => {
    const paths = Array.isArray(req.body?.paths) && req.body.paths.length > 0 ? req.body.paths : null;
    const job = await startPublish({ paths });
    res.status(202).json({ ok: true, job });
  }),
);

/** 回滚某次提交：{ commit } */
router.post(
  '/publish/rollback',
  wrap(async (req, res) => {
    const job = await startRollback(String(req.body?.commit ?? ''));
    res.status(202).json({ ok: true, job });
  }),
);

/** 只问当前任务（轻量，前端轮询用这个更省）*/
router.get('/publish/job', wrap(async (req, res) => res.json({ job: currentJob() })));

export default router;
