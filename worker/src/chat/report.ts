// 长亭 · 举报
//
//   POST /chat/:id/report   { reason }
//
// 为什么要有：这一条不是产品功能，是**备案站的义务**。现在的处置链条是
// 「AI 先发后审 → 命中就摘 → 站长巡查」，中间缺了最重要的一环：
// 看见的人没有出口。有人发了法律边缘的东西、AI 又没命中，访客只能关掉页面。
//
// 三条判断：
//   · **只记录，不自动隐藏**。按举报数自动下架是最好用的攻击手法：
//     注册三个号，就能让任何人的话消失。所以这里只落库，处置权留给站长。
//   · **一人一条只能报一次**（UNIQUE 约束），但同一条被**多个人**报要能数出来。
//   · 不告诉举报者「别人也报过」，也不回显原文 —— 举报者只需要知道「交到了」。

import type { Env } from '../types';
import { json } from '../util';
import { sessionUser } from '../auth/store';

/** 和审核口径同一套五类，外加一个 other */
const REASONS = new Set(['spam', 'abuse', 'porn', 'illegal', 'privacy', 'other']);

/** 每人每小时最多报几条：正常用户一两条，刷的人一小时能报几百条 */
const HOURLY_LIMIT = 20;

export async function reportMessage(
  request: Request,
  env: Env,
  idParam: string,
): Promise<Response> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, reason: 'not_found' }, 404);

  const me = (await sessionUser(request, env))?.account ?? null;
  if (!me) {
    return json({ ok: false, reason: 'login_required', message: '登录之后才能举报' }, 401);
  }

  let payload: { reason?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, reason: 'bad_request', message: '请求格式不对' }, 400);
  }
  const reason = String(payload.reason ?? 'other');
  if (!REASONS.has(reason)) {
    return json({ ok: false, reason: 'bad_reason', message: '选一个理由' }, 400);
  }

  const msg = await env.DB.prepare(
    'SELECT account_id, status FROM chat_messages WHERE id = ?',
  )
    .bind(id)
    .first<{ account_id: number | null; status: string }>();

  if (!msg || (msg.status !== 'visible' && msg.status !== 'pending')) {
    return json({ ok: false, reason: 'not_found', message: '这条消息不在了' }, 404);
  }
  if (msg.account_id === me.id) {
    return json({ ok: false, reason: 'self', message: '自己的话就别举报了' }, 400);
  }

  const now = Date.now();
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM chat_reports WHERE account_id = ? AND ts > ?',
  )
    .bind(me.id, now - 3_600_000)
    .first<{ n: number | null }>();
  if ((recent?.n ?? 0) >= HOURLY_LIMIT) {
    return json(
      { ok: false, reason: 'rate_limited', message: '报得有点多，歇一会儿再报' },
      429,
    );
  }

  try {
    // UNIQUE(message_id, account_id)：重复点不会多出一行，也不算失败
    const res = await env.DB.prepare(
      'INSERT OR IGNORE INTO chat_reports (message_id, account_id, reason, status, ts) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, me.id, reason, 'open', now)
      .run();
    const already = (res.meta.changes ?? 0) === 0;
    return json({
      ok: true,
      already,
      message: already ? '这条你已经报过了，站长还没看' : '交到站长那儿了，谢谢你',
    });
  } catch (err) {
    console.error('[chat] 举报落库失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '没报上去，稍后再试' }, 502);
  }
}
