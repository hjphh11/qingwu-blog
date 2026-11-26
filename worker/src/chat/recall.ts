// 长亭 · 撤回
//
// POST /chat/:id/recall
//
// 规则就三条：
//   · 只能撤回自己的
//   · 2 分钟以内（和听雨茶室一致 —— 这个窗口能覆盖「发出去才发现打错字」，又不至于让人拿撤回当编辑用）
//   · 撤回是**软删**：status 改 'recalled'，正文留在库里（出事要能查），前台只渲染一行提示
//
// ⚠️ 撤回不物理删正文，所以接口**不回显**被撤回的内容 —— 前端拿到的永远只是那些字段。
//    这一点和评论区一致。

import type { Env } from '../types';
import { json } from '../util';
import { sessionUser } from '../auth/store';
import { queueRedact, flushBridge } from './bridge';

/** 只用到 waitUntil —— 避免依赖全局的 ExecutionContext 类型 */
type Ctx = { waitUntil(p: Promise<unknown>): void };

/** 可撤回窗口 */
const RECALL_WINDOW = 2 * 60 * 1000;

export async function recallMessage(
  request: Request,
  env: Env,
  ctx: Ctx,
  idParam: string,
): Promise<Response> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, reason: 'bad_request', message: '找不到这条消息' }, 400);
  }

  let me;
  try {
    me = (await sessionUser(request, env))?.account ?? null;
  } catch {
    me = null;
  }
  // 文案同 messages.ts：不复用留言板那句「登录之后才能留言」
  if (!me) {
    return json(
      { ok: false, reason: 'login_required', message: '登录之后才能撤回自己的消息' },
      401,
    );
  }

  try {
    const row = await env.DB.prepare(
      'SELECT account_id, status, ts FROM chat_messages WHERE id = ?',
    )
      .bind(id)
      .first<{ account_id: number | null; status: string; ts: number }>();

    // 不区分「没这条」和「不是你的」—— 免得能拿来探测 id 是否存在
    if (!row || row.account_id !== me.id) {
      return json({ ok: false, reason: 'forbidden', message: '只能撤回自己发的消息' }, 403);
    }
    // 已经撤回过了当成功，免得多点两下报错
    if (row.status === 'recalled') return json({ ok: true });

    // 被判违规 / 已被站长删掉的不让「撤回」，否则等于给了一条洗白路径
    if (row.status !== 'visible' && row.status !== 'pending') {
      return json({ ok: false, reason: 'forbidden', message: '这条已经不能撤回了' }, 403);
    }

    if (Date.now() - row.ts > RECALL_WINDOW) {
      return json({ ok: false, reason: 'expired', message: '超过两分钟了，撤不回来啦' }, 403);
    }

    await env.DB.prepare(
      `UPDATE chat_messages SET status = 'recalled', updated_at = ? WHERE id = ?`,
    )
      .bind(Date.now(), id)
      .run();

    // 撤回要跟着同步到大厅：发过的那条 redact 掉，还没发的直接销账（见 bridge.ts queueRedact）
    await queueRedact(env, id);
    // 不等 cron（一分钟一次）：用户点了撤回，大厅那边应该几秒内就消失
    ctx.waitUntil(flushBridge(env, 5).catch(() => undefined));

    return json({ ok: true });
  } catch (err) {
    console.error('[chat] recall 失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '没能撤回，稍后再试' }, 502);
  }
}
