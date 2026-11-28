// 长亭 · 编辑已发
//
//   POST /chat/:id/edit   { body }
//
// 为什么要有：打错字只能撤回重发的体验很差 —— 撤回会在别人那儿留一行
// 「撤回了一条消息」，而且原话直接消失。所有 IM 都有编辑，我们之前没有。
//
// 四条约束：
//   · **只有自己的**消息能改（按 account_id 校验，不按昵称）
//   · **5 分钟内**。再久就是「改历史」了，别人引用过、回复过，改了会错位
//   · 改完必须**重新过一遍本地清单**（几何规则）—— 不重审等于给了个绕过审核的后门
//   · `updated_at` 要推上去：poll 的「30 秒内变更过」那一条会把它重发给所有人，
//     别人屏幕上的同一条随之更新，不用等刷新

import type { Env } from '../types';
import { json } from '../util';
import { sessionUser } from '../auth/store';
import { screen, type ScreenCtx } from './screen';
import { judgeLater, trustedHosts } from './messages';
import { extractUrl, warmPreview } from './link';

/** 编辑窗口。和前端按钮的显示条件必须一致（两边都写 5 分钟） */
const EDIT_WINDOW = 5 * 60 * 1000;
/** 和 messages.ts 的 BODY_MAX 对齐 */
const BODY_MAX = 500;

export async function editMessage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  idParam: string,
): Promise<Response> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, reason: 'not_found' }, 404);

  const me = (await sessionUser(request, env))?.account ?? null;
  if (!me) {
    return json(
      { ok: false, reason: 'login_required', message: '登录之后才能改自己的话' },
      401,
    );
  }

  let payload: { body?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, reason: 'bad_request', message: '请求格式不对' }, 400);
  }

  const body = String(payload.body ?? '').trim();
  if (!body) return json({ ok: false, reason: 'empty', message: '不能改成空的' }, 400);
  if (body.length > BODY_MAX) {
    return json({ ok: false, reason: 'too_long', message: `最多 ${BODY_MAX} 个字` }, 400);
  }

  const row = await env.DB.prepare(
    'SELECT account_id, body, ts, status FROM chat_messages WHERE id = ?',
  )
    .bind(id)
    .first<{ account_id: number | null; body: string; ts: number; status: string }>();

  // 「不是你的」和「没有这条」返回同一个形状：不给出「这个 id 存在」的信息
  if (!row || row.account_id !== me.id) {
    return json({ ok: false, reason: 'forbidden', message: '这条改不了' }, 403);
  }
  if (
    row.status === 'recalled' ||
    row.status === 'deleted' ||
    row.status === 'removed' ||
    row.status === 'spam'
  ) {
    return json({ ok: false, reason: 'not_editable', message: '这条已经改不了了' }, 400);
  }

  const now = Date.now();
  if (now - row.ts > EDIT_WINDOW) {
    return json(
      { ok: false, reason: 'too_late', message: '超过 5 分钟了，改不动了 —— 撤回重发吧' },
      400,
    );
  }

  // 内容没变就别写库（省一次 updated_at，也免得别人那边闪一下）
  if (body === row.body) return json({ ok: true, unchanged: true });

  /**
   * 重新过一遍本地清单。
   *
   * 三条子查询和发送路径同一套口径（最近 5 条 / 1 分钟条数 / 累计），
   * 否则「发一条干净的、5 分钟内改成广告」就能绕过审核。
   */
  const [recent, counts] = await Promise.all([
    env.DB.prepare(
      'SELECT body, ts FROM chat_messages WHERE account_id = ? AND id <> ? ORDER BY id DESC LIMIT 5',
    )
      .bind(me.id, id)
      .all<{ body: string; ts: number }>(),
    env.DB.prepare(
      `SELECT SUM(CASE WHEN ts > ? THEN 1 ELSE 0 END) AS minute_count, COUNT(*) AS total
         FROM chat_messages WHERE account_id = ?`,
    )
      .bind(now - 60 * 1000, me.id)
      .first<{ minute_count: number | null; total: number | null }>(),
  ]);

  const recentRows = recent.results ?? [];
  const sctx: ScreenCtx = {
    role: me.role,
    recentBodies: recentRows.map((r) => r.body),
    lastTs: recentRows[0]?.ts ?? 0,
    minuteCount: counts?.minute_count ?? 0,
    accountAgeHours: Math.max(0, (now - (me.created_at || now)) / 3_600_000),
    totalMessages: counts?.total ?? 0,
    now,
    trustedHosts: await trustedHosts(env),
  };

  const verdict = screen(body, sctx);
  if (verdict.action === 'block') {
    return json(
      { ok: false, reason: 'screened', message: verdict.reason || '这段改不了，换个说法' },
      400,
    );
  }

  /**
   * 正文改了，链接也可能变了。
   *
   * 不清空旧值的话，把「https://a.com」改成「https://b.com」之后，
   * 气泡下面仍挂着 a 的卡片 —— 比没有卡片更让人迷惑。
   */
  const linkUrl = extractUrl(body);

  try {
    await env.DB.prepare(
      'UPDATE chat_messages SET body = ?, link_url = ?, edited_at = ?, updated_at = ? WHERE id = ?',
    )
      .bind(body, linkUrl || null, now, now, id)
      .run();

    if (linkUrl) ctx.waitUntil(warmPreview(env, linkUrl));
  } catch (err) {
    console.error('[chat] 编辑失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '没改成，稍后再试' }, 502);
  }

  /** 编辑也要过 AI。异步、且 hasPending=false（原消息已经是可见状态，不该被降级） */
  if (!verdict.skipJudge) {
    ctx.waitUntil(
      judgeLater(env, {
        id,
        body,
        author: me.display_name || '茶客',
        wasPending: false,
      }),
    );
  }

  return json({ ok: true, body, editedAt: new Date(now).toISOString() });
}
