/**
 * 长亭 · 互联暂停开关（临时断联）
 *
 * 互联要求：维护者要能一把暂停双向同步，确认问题解决后再恢复，
 * **暂停期间的消息不得在恢复后自动补发**。
 *
 * 所以「暂停」不等于「停止拉取」：
 *   · 出站 ── 不入队（`queueBridge`）、不发送（`flushBridge`），进暂停时把
 *     队列里还没发的 `queued` 行删掉；
 *   · 入站 ── 照常 `/sync`、照常**推进游标**，只是**丢弃**这段时间的事件。
 *     不推进游标的话恢复后会一次性补进来，那就是「补发」。
 *
 * 开关放 D1 单行表 `chat_bridge_state`：worker 每次重启都要读，放内存没用。
 */

import type { Env } from '../types';

export interface BridgeState {
  paused: boolean;
  pausedAt: number | null;
  by: string | null;
  reason: string | null;
}

const OFF: BridgeState = { paused: false, pausedAt: null, by: null, reason: null };

/** 读开关。表还没迁移 / 查询失败一律当「没暂停」—— 不能因为读不到就把互联停了 */
export async function bridgeState(env: Env): Promise<BridgeState> {
  try {
    const row = await env.DB.prepare(
      `SELECT paused, paused_at, paused_by, reason FROM chat_bridge_state WHERE id = 1`,
    ).first<{ paused: number; paused_at: number | null; paused_by: string | null; reason: string | null }>();
    if (!row) return OFF;
    return {
      paused: Number(row.paused ?? 0) === 1,
      pausedAt: row.paused_at ? Number(row.paused_at) : null,
      by: row.paused_by ?? null,
      reason: row.reason ?? null,
    };
  } catch {
    return OFF;
  }
}

/** 只要布尔：热路径（每条出站 / 每轮 sync）都调它，别把整行带出去 */
export async function bridgePaused(env: Env): Promise<boolean> {
  return (await bridgeState(env)).paused;
}

/**
 * 改开关。
 *
 * 暂停时顺手把队列清干净（`queued` → 直接删）：这些是暂停前一刻排上的话，
 * 恢复后再发出去就是「补发」，要求里明确不许。
 * 已经在 `sending` 的那条不动（它可能已经在路上，删了反而对不上 event_id）。
 */
export async function setBridgePaused(
  env: Env,
  paused: boolean,
  by: string,
  reason = '',
): Promise<BridgeState> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO chat_bridge_state (id, paused, paused_at, paused_by, reason)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       paused = excluded.paused,
       paused_at = excluded.paused_at,
       paused_by = excluded.paused_by,
       reason = excluded.reason`,
  )
    .bind(paused ? 1 : 0, paused ? now : null, by, reason)
    .run();

  if (paused) {
    await env.DB.prepare(`DELETE FROM chat_outbox WHERE status = 'queued'`).run();
  }
  return { paused, pausedAt: paused ? now : null, by, reason };
}
