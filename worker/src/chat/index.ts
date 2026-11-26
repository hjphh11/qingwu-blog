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
//   POST /chat/:id/edit                       5 分钟内改自己的话（重新过清单）
//   POST /chat/:id/report                     举报一条（只落库，不自动隐藏）
//   POST /chat/:id/block                      屏蔽某人（单向、只影响我自己看到的）
//   DELETE /chat/:id/block                    取消屏蔽
//   POST /chat/pin                            站长置顶 / 取消置顶
//
// v2 再加桥接状态与 /admin 那两页；路由先不占位 —— 开着口子却没实现，
// 比 404 更难查。

import type { Env } from '../types';
import { json } from '../util';
import { getHistory, markRead, pollChat, sendMessage } from './messages';
import { getMedia, uploadMedia } from './media';
import { getRemoteAvatar, getRemoteMedia } from './sync';
import { getAccountAvatar } from './localAvatar';
import { reactToMessage } from './react';
import { recallMessage } from './recall';
import { searchChat } from './search';
import { markTyping } from './typing';
import { getWho } from './who';
import { editMessage } from './edit';
import { reportMessage } from './report';
import { setBlock } from './block';
import { setPin } from './pin';

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

  if (path === '/chat/media') {
    return method === 'POST' ? uploadMedia(request, env) : NOT_ALLOWED();
  }
  const media = path.match(/^\/chat\/media\/(\d+)$/);
  if (media) {
    return method === 'GET' ? getMedia(env, media[1]!) : NOT_ALLOWED();
  }

  // 互联头像代理：对方开了 MSC3916 认证媒体，<img> 带不了 token，只能由 worker 中转
  // 入站图片：/chat/mxc/<编码后的 mxc://…>（对方开了认证媒体，只能由 worker 转手）
  if (path.startsWith('/chat/mxc/')) {
    return method === 'GET' ? getRemoteMedia(request, env) : NOT_ALLOWED();
  }
  // 出站头像代理：/chat/avatar/u/:id（站内账号，公开）—— 必须排在下面那条通配之前
  const ownAvatar = path.match(/^\/chat\/avatar\/u\/(\d+)$/);
  if (ownAvatar) {
    return method === 'GET' ? getAccountAvatar(env, ownAvatar[1]!) : NOT_ALLOWED();
  }
  if (path.startsWith('/chat/avatar/')) {
    return method === 'GET' ? getRemoteAvatar(request, env) : NOT_ALLOWED();
  }

  // /chat/:id/recall
  const recall = path.match(/^\/chat\/(\d+)\/recall$/);
  if (recall) {
    return method === 'POST' ? recallMessage(request, env, ctx, recall[1]!) : NOT_ALLOWED();
  }

  // /chat/:id/react
  const react = path.match(/^\/chat\/(\d+)\/react$/);
  if (react) {
    return method === 'POST' ? reactToMessage(request, env, react[1]!) : NOT_ALLOWED();
  }

  // /chat/:id/edit
  const edit = path.match(/^\/chat\/(\d+)\/edit$/);
  if (edit) {
    return method === 'POST' ? editMessage(request, env, ctx, edit[1]!) : NOT_ALLOWED();
  }

  // /chat/:id/report
  const report = path.match(/^\/chat\/(\d+)\/report$/);
  if (report) {
    return method === 'POST' ? reportMessage(request, env, ctx, report[1]!) : NOT_ALLOWED();
  }

  // /chat/:id/block —— 屏蔽 / 取消屏蔽（单向：只有我看不见他）
  const block = path.match(/^\/chat\/(\d+)\/block$/);
  if (block) {
    if (method === 'POST') return setBlock(request, env, block[1]!, true);
    if (method === 'DELETE') return setBlock(request, env, block[1]!, false);
    return NOT_ALLOWED();
  }

  // 置顶（站长）
  if (path === '/chat/pin') {
    return method === 'POST' ? setPin(request, env) : NOT_ALLOWED();
  }

  return json({ ok: false, reason: 'not_found' }, 404);
}
