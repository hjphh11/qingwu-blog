// 长亭 · 路由分发
//
// 对外是 /api/chat/*（nginx 的 location /api/ 去前缀转发到这里），
// 和 auth / admin 一个写法：入口在 src/index.ts 只有一行，这里自己分派。
//
// 已启用（v1）：
//   GET  /chat/history?before=<id>&limit=50   首屏 / 向上翻页
//   GET  /chat/poll?after=<id>                增量 + 在线人数 + 被撤回的 id
//   GET  /chat/who                            侧栏：在线的人
//   GET  /chat/search?q=                      搜索聊天记录
//   POST /chat/send                           发一条（可带 replyTo / mentions）
//   POST /chat/read                           更新阅读游标
//   POST /chat/typing                         报告「正在输入」
//   POST /chat/:id/recall                     2 分钟内撤回自己的
//   POST /chat/:id/react                      表情回应（再点一次取消）
//
// v2 再加桥接状态与 /admin 那两页；路由先不占位 —— 开着口子却没实现，
// 比 404 更难查。

import type { Env } from '../types';
import { json } from '../util';
import { getHistory, markRead, pollChat, sendMessage } from './messages';
import { reactToMessage } from './react';
import { recallMessage } from './recall';
import { searchChat } from './search';
import { markTyping } from './typing';
import { getWho } from './who';

const NOT_ALLOWED = () => json({ ok: false, reason: 'method_not_allowed' }, 405);

export async function handleChat(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  const method = request.method;

  if (path === '/chat/history') {
    return method === 'GET' ? getHistory(request, env) : NOT_ALLOWED();
  }

  if (path === '/chat/poll') {
    return method === 'GET' ? pollChat(request, env) : NOT_ALLOWED();
  }

  // 侧栏：我的称号/发言数 + 在线的人。30 秒刷一次就够，不该跟 poll 一起 2.5 秒跑
  if (path === '/chat/who') {
    return method === 'GET' ? getWho(request, env) : NOT_ALLOWED();
  }

  if (path === '/chat/send') {
    return method === 'POST' ? sendMessage(request, env, ctx) : NOT_ALLOWED();
  }

  if (path === '/chat/read') {
    return method === 'POST' ? markRead(request, env) : NOT_ALLOWED();
  }

  // 正在输入（前端 3 秒最多报一次）
  if (path === '/chat/typing') {
    return method === 'POST' ? markTyping(request, env) : NOT_ALLOWED();
  }

  // 搜索聊天记录
  if (path === '/chat/search') {
    return method === 'GET' ? searchChat(request, env) : NOT_ALLOWED();
  }

  // /chat/:id/recall
  const recall = path.match(/^\/chat\/(\d+)\/recall$/);
  if (recall) {
    return method === 'POST' ? recallMessage(request, env, recall[1]!) : NOT_ALLOWED();
  }

  // /chat/:id/react
  const react = path.match(/^\/chat\/(\d+)\/react$/);
  if (react) {
    return method === 'POST' ? reactToMessage(request, env, react[1]!) : NOT_ALLOWED();
  }

  return json({ ok: false, reason: 'not_found' }, 404);
}
