// 长亭 · 置顶
//
//   POST /chat/pin   { messageId }   （messageId = 0 表示取消）
//
// 为什么要有：现在侧栏那段「长亭的话」是写在 `ChatAside.tsx` 的常量里的，
// 改一句话就得发一次版。置顶把「此刻想说的事」交给数据，站长点一下就换。
//
// 三条约束：
//   · **只有站长能置顶**。它是给人看的公告位，不是公共黑板。
//   · 一间房**只有一个置顶位**（表里主键钉死 'main'）：两个公告等于没有公告。
//   · poll 每次都带 pin —— 一百来个字节，比「等下次刷新才看见」值得多。

import type { Env } from '../types';
import { json } from '../util';
import { sessionUser } from '../auth/store';

export interface PinInfo {
  id: number;
  name: string;
  excerpt: string;
  at: string;
}

/** 置顶条只放一句摘要，太长会把整个会话区往下推 */
const EXCERPT_MAX = 60;

/**
 * 读当前置顶。表还没建 / 查挂了都按「没有置顶」处理 ——
 * 一条装饰性的横幅不该让整个聊天室打不开。
 */
export async function getPin(env: Env): Promise<PinInfo | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT m.id, m.body, m.ts,
              COALESCE(a.display_name, substr(a.email, 1, instr(a.email, '@') - 1)) AS name
         FROM chat_pins p
         JOIN chat_messages m ON m.id = p.message_id
         LEFT JOIN accounts a ON a.id = m.account_id
        WHERE p.room = 'main' AND m.status = 'visible'`,
    ).first<{ id: number; body: string; ts: number; name: string | null }>();

    if (!row) return null;
    const flat = row.body.replace(/\s+/g, ' ').trim();
    return {
      id: row.id,
      name: row.name || '有人',
      excerpt: flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX)}…` : flat,
      at: new Date(row.ts).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function setPin(request: Request, env: Env): Promise<Response> {
  const me = (await sessionUser(request, env))?.account ?? null;
  if (!me) return json({ ok: false, reason: 'login_required', message: '登录之后才能置顶' }, 401);
  if (me.role !== 'admin') {
    return json({ ok: false, reason: 'forbidden', message: '只有站长能置顶' }, 403);
  }

  let payload: { messageId?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, reason: 'bad_request', message: '请求格式不对' }, 400);
  }

  const id = Number(payload.messageId) || 0;
  const now = Date.now();

  if (id <= 0) {
    await env.DB.prepare("DELETE FROM chat_pins WHERE room = 'main'").run();
    return json({ ok: true, pin: null });
  }

  const msg = await env.DB.prepare('SELECT status FROM chat_messages WHERE id = ?')
    .bind(id)
    .first<{ status: string }>();
  if (!msg || msg.status !== 'visible') {
    return json({ ok: false, reason: 'not_found', message: '这条消息不在了' }, 404);
  }

  await env.DB.prepare(
    `INSERT INTO chat_pins (room, message_id, account_id, ts) VALUES ('main', ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET message_id = excluded.message_id,
                                       account_id = excluded.account_id,
                                       ts = excluded.ts`,
  )
    .bind(id, me.id, now)
    .run();

  return json({ ok: true, pin: await getPin(env) });
}
