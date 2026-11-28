// 长亭 · 表情回应
//
// POST /chat/:id/react  { emoji }
//
// 一条消息 + 一个人 + 一个表情 = 一行（见 0026 的 chat_reactions 主键）。
// 同一个人再点同一个表情就是取消 —— 聊天室里「点错了想收回」比「攒很多个」常见得多。
//
// ⚠️ emoji 只做**形状校验**（`^[a-z0-9_]{1,32}$`），不校验它是否真的在表情清单里。
//    服务端没有那份清单（在 src/lib/emojis.ts，属于前端资源），
//    而多存一个渲染不出来的 key 没有任何危害 —— 前端找不到图就显示不出来而已。
//    真正要挡的是「塞一段 HTML / 超长字符串进来」，形状校验足够。

import type { Env } from '../types';
import { json } from '../util';
import { chatSessionUser } from '../auth/store';
import { mergeRemoteReactions, type Reaction } from './messages';

const EMOJI_RE = /^[a-z0-9_]{1,32}$/;

export async function reactToMessage(
  request: Request,
  env: Env,
  idParam: string,
): Promise<Response> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, reason: 'bad_request', message: '找不到这条消息' }, 400);
  }

  let me;
  try {
    me = (await chatSessionUser(request, env))?.account ?? null;
  } catch {
    me = null;
  }
  if (!me) {
    return json(
      { ok: false, reason: 'login_required', message: '登录之后才能回应' },
      401,
    );
  }

  let emoji = '';
  try {
    const body = (await request.json()) as { emoji?: unknown };
    emoji = String(body.emoji ?? '').trim();
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }
  if (!EMOJI_RE.test(emoji)) {
    return json({ ok: false, reason: 'bad_emoji', message: '这个表情不认识' }, 400);
  }

  try {
    // 只能对「正常显示中」的消息回应。撤回的、被拦的、删掉的一律不认
    const msg = await env.DB.prepare(
      `SELECT id FROM chat_messages WHERE id = ? AND status = 'visible'`,
    )
      .bind(id)
      .first<{ id: number }>();
    if (!msg) {
      return json({ ok: false, reason: 'not_found', message: '这条已经不在了' }, 404);
    }

    const existing = await env.DB.prepare(
      'SELECT 1 AS x FROM chat_reactions WHERE message_id = ? AND account_id = ? AND emoji = ?',
    )
      .bind(id, me.id, emoji)
      .first<{ x: number }>();

    if (existing) {
      await env.DB.prepare(
        'DELETE FROM chat_reactions WHERE message_id = ? AND account_id = ? AND emoji = ?',
      )
        .bind(id, me.id, emoji)
        .run();
    } else {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO chat_reactions (message_id, account_id, emoji, ts) VALUES (?, ?, ?, ?)',
      )
        .bind(id, me.id, emoji, Date.now())
        .run();
    }

    // 回这条消息的最新汇总，前端直接替换，不用自己算
    const rows = await env.DB.prepare(
      `SELECT emoji, COUNT(*) AS n, MAX(CASE WHEN account_id = ? THEN 1 ELSE 0 END) AS mine
         FROM chat_reactions WHERE message_id = ?
        GROUP BY emoji ORDER BY n DESC, emoji ASC`,
    )
      .bind(me.id, id)
      .all<{ emoji: string; n: number; mine: number }>();

    /**
     * 回这条消息的最新汇总，前端直接替换。
     *
     * ⚠️ 必须也带上大厅那边的（`mergeRemoteReactions`）—— 只回本地的话，
     * 用户点一下自己的表情，屏幕上对方点的 🔥 会当场消失，下次 poll 才回来。
     */
    const map = new Map<number, Reaction[]>([
      [id, (rows.results ?? []).map((r) => ({ emoji: r.emoji, n: r.n, mine: r.mine === 1 }))],
    ]);
    await mergeRemoteReactions(env, [id], map);

    return json({ ok: true, reacted: !existing, reactions: map.get(id) ?? [] });
  } catch (err) {
    console.error('[chat] react 失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '没能回应，稍后再试' }, 502);
  }
}
