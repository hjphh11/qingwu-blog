/**
 * 茶室互联 · 入站（matrix.rainzt.cn 的「大厅」 → 清吾长亭）
 *
 * 方案 §46.5 第 3 步。出站见 `bridge.ts`，这里只管把**别人的新消息**拉回来。
 *
 * ## 三条硬约束（对方提的，也是我们自己的要求）
 *
 * 1. **旧历史不回灌**：第一次 sync 只记游标（`next_batch`），一条都不入库。
 *    否则一接上就往长亭里倒几百条大厅旧话，看着像清吾被灌了。
 * 2. **去重靠 `matrix_event_id`**（0026 建了唯一索引）：/sync 的游标抖动、
 *    重试、多实例抢跑都可能让同一个事件来两次，插入冲突就当已处理。
 * 3. **自己的回声要丢掉**：我们 PUT 出去的事件 Synapse 也会 /sync 回来，
 *    那些在本地本来就是 `origin='local'` 的消息，再插一条 remote 就重复了。
 *    判据是 `unsigned.transaction_id` 的 `qingwu-` 前缀（出站 txn 的命名规则）。
 */
import type { Env } from '../types';
import { bridgeOf } from './bridge';

/** 投递一次最多入库多少条 —— 大厅很热闹，一轮灌太多会顶到 D1 的写上限 */
const MAX_INSERT = 30;

/** 抢锁时长：防止 cron 与手动触发撞在一起，同一批事件插两次 */
const LOCK_MS = 45_000;

type SyncEvent = {
  type?: string;
  event_id?: string;
  sender?: string;
  origin_server_ts?: number;
  unsigned?: { transaction_id?: string };
  content?: Record<string, unknown>;
};

/** /sync 的过滤：只要目标房间、只要最近 50 条，不要全部房间的状态 */
function filterOf(room: string): string {
  return JSON.stringify({
    room: { rooms: [room], timeline: { limit: 50 } },
    presence: { not_types: ['*'] },
    account_data: { not_types: ['*'] },
  });
}

/** `[ID:qingwu-u12];[URL:https://…]` 这种协议头，返回两段 */
export function parseHead(line: string): { id: string; avatar: string } {
  const id = /\[ID:([^\]]*)\]/.exec(line)?.[1] ?? '';
  const avatar = /\[URL:([^\]]*)\]/.exec(line)?.[1] ?? '';
  return { id: id.trim(), avatar: avatar.trim() };
}

export type RemoteParsed = {
  body: string;
  nick: string;
  avatar: string;
  sender: string;
  site: string;
  eventId: string;
  ts: number;
};

/**
 * 把一个 Matrix 事件解析成我们要存的样子（纯函数，好单测）。
 *
 * 优先读结构化的 `org.tea-room.bridge`（rainzt 用这个）；读不到就退回 body：
 * 首行是协议头就剥掉，那时头像也只能从首行拿 —— 结构化里没有头像字段。
 */
export function parseRemoteEvent(ev: SyncEvent): RemoteParsed | null {
  if (ev.type !== 'm.room.message' || !ev.event_id || !ev.sender) return null;
  const c = (ev.content ?? {}) as Record<string, unknown>;
  if (c.msgtype !== 'm.text') return null; // 媒体是下一步的事

  const bf = (c['org.tea-room.bridge'] ?? {}) as {
    actor?: { id?: string; nick?: string };
    site?: string;
    text?: string;
  };

  const rawBody = typeof c.body === 'string' ? c.body : '';
  const lines = rawBody.split('\n');
  const head = lines.length > 1 ? parseHead(lines[0]!) : { id: '', avatar: '' };
  // 首行是协议头就剥掉；不是就当正文的一部分
  const looksLikeHead = lines.length > 1 && (/\[ID:[^\]]*\]/.test(lines[0]!) || /\[URL:[^\]]*\]/.test(lines[0]!));
  const bodyFromRaw = looksLikeHead ? lines.slice(1).join('\n') : rawBody;

  const body = (typeof bf.text === 'string' && bf.text.trim() ? bf.text : bodyFromRaw).trim();
  if (!body) return null;

  // 昵称：结构化优先，其次 `@nick:server` 的 localpart
  const nick =
    (typeof bf.actor?.nick === 'string' && bf.actor.nick.trim()) ||
    ev.sender.replace(/^@/, '').split(':')[0] ||
    '远方的茶客';

  // 站点：结构化优先；没有就退到「发信人所在服务器的域名」—— 比空着强
  const site =
    (typeof bf.site === 'string' && bf.site.trim()) ||
    (ev.sender.includes(':') ? `https://${ev.sender.split(':')[1]}` : '');

  return {
    // 结构化里的 actor.id 是对方站内的身份键（如 rainzt 的 uuid），
    // 存进 remote_sender 比完整 mxid 更有用（同一人换 MXID 也不会变成两个人）
    sender: (typeof bf.actor?.id === 'string' && bf.actor.id.trim()) || ev.sender,
    nick,
    avatar: head.avatar,
    site,
    body,
    eventId: ev.event_id,
    ts: Number(ev.origin_server_ts) || Date.now(),
  };
}

/** 自己的出站回声：txn 是我们 `qingwu-<消息id>-<随机>` 的命名 */
function isOwnEcho(ev: SyncEvent): boolean {
  const txn = ev.unsigned?.transaction_id;
  return typeof txn === 'string' && txn.startsWith('qingwu-');
}

/**
 * 拉一次 /sync 并入库。由 scheduled 每分钟调用。
 *
 * 返回值里 `first` 表示这是接上来的第一轮（只记游标，不入库）。
 */
export async function pullBridge(env: Env): Promise<{ added: number; skipped: number; first: boolean }> {
  const cfg = bridgeOf(env);
  if (!cfg) return { added: 0, skipped: 0, first: false };

  const now = Date.now();

  // 抢锁：先确保有一行，再 CAS 式地拿到锁
  await env.DB.prepare(
    `INSERT INTO chat_sync (id, room_id, since, lock_until, updated_at)
     VALUES (1, ?, NULL, 0, ?)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(cfg.room, now)
    .run();

  const lock = await env.DB.prepare(
    `UPDATE chat_sync SET lock_until = ?, updated_at = ? WHERE id = 1 AND lock_until < ?`,
  )
    .bind(now + LOCK_MS, now, now)
    .run();
  if (Number(lock.meta?.changes ?? 0) === 0) return { added: 0, skipped: 0, first: false };

  try {
    const row = await env.DB.prepare(`SELECT since, room_id FROM chat_sync WHERE id = 1`).first<{
      since: string | null;
      room_id: string | null;
    }>();
    // 换了房间就该重新对齐游标，别拿旧房间的 since 去问新房间
    const since = row?.room_id === cfg.room ? row?.since : null;

    const qs = new URLSearchParams({ timeout: '0', filter: filterOf(cfg.room) });
    if (since) qs.set('since', since);

    const res = await fetch(`${cfg.hs}/_matrix/client/v3/sync?${qs.toString()}`, {
      headers: { authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).slice(0, 160);
      console.error(`[bridge] /sync ${res.status}: ${t}`);
      return { added: 0, skipped: 0, first: false };
    }

    const data = (await res.json().catch(() => ({}))) as {
      next_batch?: string;
      rooms?: { join?: Record<string, { timeline?: { events?: SyncEvent[] } }> };
    };

    const nextBatch = data.next_batch;
    const events = data.rooms?.join?.[cfg.room]?.timeline?.events ?? [];

    // 第一轮：只记游标，不回灌历史
    if (!since) {
      await env.DB.prepare(
        `UPDATE chat_sync SET room_id = ?, since = ?, lock_until = 0, updated_at = ? WHERE id = 1`,
      )
        .bind(cfg.room, nextBatch ?? null, Date.now())
        .run();
      return { added: 0, skipped: events.length, first: true };
    }

    let added = 0;
    let skipped = 0;

    // 从旧到新处理；超过 MAX_INSERT 就留到下一轮（游标不前进时会重来）
    const queue = events.filter((e) => !isOwnEcho(e)).slice(-MAX_INSERT);

    for (const ev of queue) {
      const p = parseRemoteEvent(ev);
      if (!p) {
        skipped += 1;
        continue;
      }
      // matrix_event_id 有唯一索引：重复插入会抛，用 OR IGNORE 直接当已处理
      const ins = await env.DB.prepare(
        `INSERT OR IGNORE INTO chat_messages
           (account_id, body, kind, status, ts, updated_at, origin,
            remote_sender, remote_nick, remote_avatar, remote_site, matrix_event_id)
         VALUES (NULL, ?, 'text', 'visible', ?, ?, 'remote', ?, ?, ?, ?, ?)`,
      )
        .bind(p.body, p.ts, Date.now(), p.sender, p.nick, p.avatar, p.site, p.eventId)
        .run();
      if (Number(ins.meta?.changes ?? 0) > 0) added += 1;
      else skipped += 1;
    }

    await env.DB.prepare(
      `UPDATE chat_sync SET room_id = ?, since = ?, lock_until = 0, updated_at = ? WHERE id = 1`,
    )
      .bind(cfg.room, nextBatch ?? since, Date.now())
      .run();

    return { added, skipped, first: false };
  } catch (err) {
    console.error('[bridge] 入站失败:', err instanceof Error ? err.message : err);
    return { added: 0, skipped: 0, first: false };
  } finally {
    // 无论成败都放锁，否则要等 LOCK_MS 自然过期
    await env.DB.prepare(`UPDATE chat_sync SET lock_until = 0 WHERE id = 1`).run().catch(() => {});
  }
}
