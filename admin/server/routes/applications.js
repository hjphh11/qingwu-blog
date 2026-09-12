// 友链申请审批接口（阶段 J · 方案 §4.5）。
//
// 申请数据在**私有仓库**里（含访客邮箱），这里只是读它、并把审批结果写回去。
// 通过 = 追加到 links.json（进入「待发布」）→ 去发布页发布就上线（阶段 I）。
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  applicationsSummary,
  approveApplication,
  listApplications,
  rejectApplication,
  reopenApplication,
} from '../applications.js';

const router = Router();
router.use(requireAuth);

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 审批列表。`?refresh=1` 绕过服务端缓存（刚在手机上看到新申请时用）*/
router.get(
  '/applications',
  wrap(async (req, res) => {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await listApplications({ force }));
  }),
);

/** 侧栏角标：只要「待审批」数量（走缓存）*/
router.get('/applications/summary', wrap(async (req, res) => res.json(await applicationsSummary())));

/** 通过 → 写进 links.json（待发布）*/
router.post(
  '/applications/approve',
  wrap(async (req, res) => {
    const r = await approveApplication(req.body?.id);
    res.json({ ok: true, ...r, ...(await listApplications({ force: true })) });
  }),
);

/** 拒绝 → 标记（可留原因）*/
router.post(
  '/applications/reject',
  wrap(async (req, res) => {
    const r = await rejectApplication(req.body?.id, req.body?.reason);
    res.json({ ok: true, ...r, ...(await listApplications({ force: true })) });
  }),
);

/** 点错了能撤回：改回待审批 */
router.post(
  '/applications/reopen',
  wrap(async (req, res) => {
    const r = await reopenApplication(req.body?.id);
    res.json({ ok: true, ...r, ...(await listApplications({ force: true })) });
  }),
);

export default router;
