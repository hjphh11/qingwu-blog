// 清吾 · 后台路由分发
//
// 对外实际路径是 `/api/admin/*` —— nginx 的 `location /api/` 会把前缀去掉，
// 所以到这里已经是 `/admin/*`。**nginx 一行都不用改**，这也是这套方案的前提之一。
//
// 设计见 docs/方案-后台-admin.md 第四节。

import type { Env } from '../types';
import { json } from '../util';
import { getSessionInfo, postLogin, postLogout, postVerify, requireAdmin } from './auth';
import { getThread, listComments, replyToComment, setCommentStatus } from './comments';

export async function handleAdmin(request: Request, env: Env, path: string): Promise<Response> {
  const m = request.method;

  // —— 登录前的三条 ——
  if (path === '/admin/login' && m === 'POST') return postLogin(request, env);
  if (path === '/admin/verify' && m === 'POST') return postVerify(request, env);
  if (path === '/admin/logout' && m === 'POST') return postLogout(request, env);
  if (path === '/admin/session' && m === 'GET') return getSessionInfo(request, env);

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

  return json({ ok: false, reason: 'not_found' }, 404);
}
