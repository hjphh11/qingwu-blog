// 阶段 K 的便捷功能接口：全局搜索 / 一键导出备份 / 定时发布。阶段 M 加了访问统计。
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { buildBackup } from '../backup.js';
import { addSchedule, cancelSchedule, clearFinished, listSchedule } from '../schedule.js';
import { searchAll } from '../search.js';
import { getStats, statsSummary } from '../stats.js';

const router = Router();
router.use(requireAuth);

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 全局搜索（第 44 条）：Cmd/Ctrl+K 那个框用它 */
router.get(
  '/search',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '');
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 6));
    res.json(await searchAll(q, { limit }));
  }),
);

/** 一键导出备份（§4.15）：直接下 zip */
router.get(
  '/backup',
  wrap(async (req, res) => {
    const { buf, name, files, manifest } = await buildBackup();
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('content-length', String(buf.length));
    // 顺手把这些暴露给前端（同源才能读）
    res.setHeader('x-backup-files', String(files.length));
    res.setHeader('x-backup-commit', String(manifest.commit));
    res.send(buf);
  }),
);

/** 备份的“元信息”（不下载，只看有多少文件、当前提交是什么）*/
router.get(
  '/backup/info',
  wrap(async (req, res) => {
    const { files, manifest } = await buildBackup({ date: new Date(0) });
    res.json({ count: files.length, commit: manifest.commit, at: manifest.createdAt });
  }),
);

/** 定时发布（§4.12）*/
router.get('/schedule', wrap(async (req, res) => res.json(await listSchedule())));
router.post(
  '/schedule',
  wrap(async (req, res) => res.json({ ok: true, ...(await addSchedule(req.body ?? {})) })),
);
router.post(
  '/schedule/cancel',
  wrap(async (req, res) => res.json({ ok: true, ...(await cancelSchedule(String(req.body?.id ?? ''))) })),
);
router.post(
  '/schedule/clear',
  wrap(async (req, res) => res.json({ ok: true, ...(await clearFinished()) })),
);

/** 访问统计（阶段 M · §11 路线 B）：读私有仓库里那份由 Action 汇总的 stats.json */
router.get(
  '/stats',
  wrap(async (req, res) => {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await getStats({ force }));
  }),
);
router.get('/stats/summary', wrap(async (req, res) => res.json(await statsSummary())));

export default router;
