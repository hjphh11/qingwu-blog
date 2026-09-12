// 友链 / 分享 / 关于页的读写接口（阶段 G）。
//
// 都是**整块保存**的语义：后台改好整块再 PUT 回来（增删改排序一次提交），
// 只有「删除」是单独接口 —— 因为它要走回收站（软删除）。
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getAbout, saveAbout } from '../about.js';
import { deleteLink, listLinks, saveLinks } from '../links.js';
import { allShareTags, deleteShare, listShares, saveShares } from '../shares.js';

const router = Router();
router.use(requireAuth);

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ——— 友链 ———
router.get('/links', wrap(async (req, res) => res.json(await listLinks())));
router.put(
  '/links',
  wrap(async (req, res) => res.json({ ok: true, ...(await saveLinks(req.body ?? {})) })),
);
router.post(
  '/links/delete',
  wrap(async (req, res) => {
    const r = await deleteLink(req.body?.url);
    res.json({ ok: true, ...r, ...(await listLinks()) });
  }),
);

// ——— 分享 / 语录 ———
router.get('/shares', wrap(async (req, res) => res.json(await listShares())));
router.get('/shares/tags', wrap(async (req, res) => res.json({ tags: await allShareTags() })));
router.put(
  '/shares',
  wrap(async (req, res) => res.json({ ok: true, ...(await saveShares(req.body ?? {})) })),
);
router.post(
  '/shares/delete',
  wrap(async (req, res) => {
    const r = await deleteShare(req.body?.id);
    res.json({ ok: true, ...r, ...(await listShares()) });
  }),
);

// ——— 关于页 ———
router.get('/about', wrap(async (req, res) => res.json(await getAbout())));
router.put(
  '/about',
  wrap(async (req, res) => res.json({ ok: true, about: await saveAbout(req.body ?? {}) })),
);

export default router;
