// 长亭 · 「正在输入」
//
// POST /chat/typing
//
// 前端每 3 秒最多报一次（在输入框有内容时）。后端只写一行时间戳，
// 判定交给 poll 的 6 秒窗口（见 messages.ts 的 TYPING_WINDOW）。
//
// 为什么不建新表：它和「在线」是同一件事的两个刻度，直接挂在 chat_presence 上。
// 为什么不做服务端节流：一次 UPDATE 一行的成本远低于多查一次「上次是什么时候」。
// 前端那侧必须节流（不然光打字就能把接口打成 DoS），那是它该负的责任。

import type { Env } from '../types';
import { json } from '../util';
import { chatSessionUser } from '../auth/store';

export async function markTyping(request: Request, env: Env): Promise<Response> {
  let me;
  try {
    me = (await chatSessionUser(request, env))?.account ?? null;
  } catch {
    me = null;
  }
  // 未登录直接当成功：他本来就不在名单里，不需要知道「你没登录」
  if (!me) return json({ ok: true });

  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO chat_presence (account_id, last_seen, typing_at) VALUES (?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET typing_at = excluded.typing_at`,
    )
      .bind(me.id, now, now)
      .run();
    return json({ ok: true });
  } catch {
    // 输入状态丢了不痛不痒，绝不该弹错误
    return json({ ok: false });
  }
}
