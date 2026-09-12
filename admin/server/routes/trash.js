// 回收站接口 —— 所有类型的软删除集中在这里。
//
// 「恢复」按条目的 type 分派给对应模块（各模块自己知道怎么还原），
// 这样 trash.js 不用反过来 import 各模块，避免循环依赖。
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { restoreArticleFromTrash } from '../articles.js';
import { badRequest } from '../jsonFile.js';
import { restoreFriendFromTrash } from '../links.js';
import { restoreShareFromTrash } from '../shares.js';
import { listTrash, purgeTrash, readTrashEntry } from '../trash.js';

const router = Router();
router.use(requireAuth);

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 各类型怎么还原 */
const RESTORERS = {
  article: restoreArticleFromTrash,
  friend: restoreFriendFromTrash,
  share: restoreShareFromTrash,
};

router.get('/trash', wrap(async (req, res) => res.json({ items: await listTrash() })));

router.post(
  '/trash/:entry/restore',
  wrap(async (req, res) => {
    const obj = await readTrashEntry(req.params.entry);
    const restore = RESTORERS[obj.type];
    if (!restore) throw badRequest(`还不支持恢复「${obj.type}」类型的内容`);
    const r = await restore(obj);
    await purgeTrash(req.params.entry);
    res.json({ ...r, entry: req.params.entry, type: obj.type });
  }),
);

router.post(
  '/trash/:entry/purge',
  wrap(async (req, res) => res.json(await purgeTrash(req.params.entry))),
);

export default router;
