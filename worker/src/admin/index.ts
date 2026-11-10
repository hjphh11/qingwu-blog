// 清吾 · 后台路由分发
//
// 对外实际路径是 `/api/admin/*` —— nginx 的 `location /api/` 会把前缀去掉，
// 所以到这里已经是 `/admin/*`。**nginx 一行都不用改**，这也是这套方案的前提之一。
//
// 设计见 docs/方案-后台-admin.md 第四节。

import type { Env } from '../types';
import { json } from '../util';
import { getAiStatus, postAiDraft, postAiJudge, postFriendReply } from './ai';
import { getDevLogin, getSessionInfo, postLogin, postLogout, postVerify, requireAdmin } from './auth';
import { getThread, listComments, replyToComment, setCommentStatus } from './comments';
import { getBlockedLog } from './moderation';
import { getPublishLog } from './publish';
import { getSettings, patchSettings } from './settings';
import { getStats } from './stats';
import { getStatus, postStatusPing, getAutoReplyLog } from './status';
import {
  checkBacklinks,
  commitLinks,
  getFriendsOverview,
  patchApplication,
  probeApplication,
  sendApplicationMail,
  setFriendStatus,
} from './friends';

export async function handleAdmin(request: Request, env: Env, path: string): Promise<Response> {
  const m = request.method;

  // —— 登录前的三条 ——
  if (path === '/admin/login' && m === 'POST') return postLogin(request, env);
  if (path === '/admin/verify' && m === 'POST') return postVerify(request, env);
  if (path === '/admin/logout' && m === 'POST') return postLogout(request, env);
  if (path === '/admin/session' && m === 'GET') return getSessionInfo(request, env);

  // —— 本地预览用的一键登录：没配 ADMIN_DEV_LOGIN 时恒 404 ——
  if (path === '/admin/dev-login' && m === 'GET') return getDevLogin(request, env);

  // —— 以下全部要求会话 ——
  if (path === '/admin/comments' && m === 'GET') {
    return requireAdmin(request, env, (admin) => listComments(request, env, admin));
  }

  const thread = path.match(/^\/admin\/comments\/(\d+)$/);
  if (thread && m === 'GET') {
    const id = Number(thread[1]);
    return requireAdmin(request, env, (admin) => getThread(request, env, admin, id));
  }

  const reply = path.match(/^\/admin\/comments\/(\d+)\/reply$/);
  if (reply && m === 'POST') {
    const id = Number(reply[1]);
    return requireAdmin(request, env, (admin) => replyToComment(request, env, admin, id));
  }

  const status = path.match(/^\/admin\/comments\/(\d+)\/status$/);
  if (status && m === 'PATCH') {
    const id = Number(status[1]);
    return requireAdmin(request, env, (admin) => setCommentStatus(request, env, admin, id));
  }

  // —— AI（writer 起草/润色，judge 单条体检）——
  if (path === '/admin/ai/status' && m === 'GET') {
    return requireAdmin(request, env, (admin) => getAiStatus(request, env, admin));
  }
  if (path === '/admin/ai/draft' && m === 'POST') {
    return requireAdmin(request, env, (admin) => postAiDraft(request, env, admin));
  }
  if (path === '/admin/ai/judge' && m === 'POST') {
    return requireAdmin(request, env, (admin) => postAiJudge(request, env, admin));
  }
  // 友链申请：探测对方站点 + 起草回信（两步一起返回）
  if (path === '/admin/ai/friend-reply' && m === 'POST') {
    return requireAdmin(request, env, (admin) => postFriendReply(request, env, admin));
  }

  // —— 运行状态（总览 + 通道探活）与统计（图表）——
  if (path === '/admin/status' && m === 'GET') {
    return requireAdmin(request, env, (admin) => getStatus(request, env, admin));
  }
  if (path === '/admin/status/ping' && m === 'POST') {
    return requireAdmin(request, env, (admin) => postStatusPing(request, env, admin));
  }
  // 自动回复流水（可翻页）。单独一条，翻页不必重跑整页状态
  if (path === '/admin/auto-reply/log' && m === 'GET') {
    return requireAdmin(request, env, (admin) => getAutoReplyLog(request, env, admin));
  }
  if (path === '/admin/stats' && m === 'GET') {
    return requireAdmin(request, env, (admin) => getStats(request, env, admin));
  }

  // —— 拦截记录（审核页底部那块）——
  if (path === '/admin/review/blocked' && m === 'GET') {
    return requireAdmin(request, env, (admin) => getBlockedLog(request, env, admin));
  }

  // —— 可调设置（自动回复策略 / writer 参数 / 审核规则）——
  if (path === '/admin/settings' && m === 'GET') {
    return requireAdmin(request, env, (admin) => getSettings(request, env, admin));
  }
  if (path === '/admin/settings' && m === 'PATCH') {
    return requireAdmin(request, env, (admin) => patchSettings(request, env, admin));
  }

  // —— 友链（P2 审核 / P3 回链）——
  if (path === '/admin/friends' && m === 'GET') {
    return requireAdmin(request, env, (admin) => getFriendsOverview(request, env, admin));
  }
  if (path === '/admin/friends/links' && m === 'POST') {
    return requireAdmin(request, env, (admin) => commitLinks(request, env, admin));
  }
  if (path === '/admin/friends/publish-log' && m === 'GET') {
    return requireAdmin(request, env, (admin) => getPublishLog(request, env, admin));
  }
  if (path === '/admin/friends/backlinks' && m === 'POST') {
    return requireAdmin(request, env, (admin) => checkBacklinks(request, env, admin));
  }
  if (path === '/admin/friends/status' && m === 'POST') {
    return requireAdmin(request, env, (admin) => setFriendStatus(request, env, admin));
  }

  const apply = path.match(/^\/admin\/friends\/apply\/(\d+)$/);
  if (apply && m === 'POST') {
    const id = Number(apply[1]);
    return requireAdmin(request, env, (admin) => patchApplication(request, env, admin, id));
  }

  const probe = path.match(/^\/admin\/friends\/applications\/(\d+)\/probe$/);
  if (probe && m === 'POST') {
    const id = Number(probe[1]);
    return requireAdmin(request, env, (admin) => probeApplication(request, env, admin, id));
  }

  const mail = path.match(/^\/admin\/friends\/applications\/(\d+)\/mail$/);
  if (mail && m === 'POST') {
    const id = Number(mail[1]);
    return requireAdmin(request, env, (admin) => sendApplicationMail(request, env, admin, id));
  }

  return json({ ok: false, reason: 'not_found' }, 404);
}
