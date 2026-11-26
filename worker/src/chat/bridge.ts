/**
 * 茶室互联 · 出站（清吾 → matrix.rainzt.cn 的「大厅」）
 *
 * 设计口径见 `docs/方案-聊天室.md` §46.5 / §46.6。这里只做**出站文字**，
 * 入站（/sync）和媒体是后面两步的事 —— 别在这个文件里混进来。
 *
 * ## 为什么走 outbox 而不是「发送时直接 fetch」
 *
 * 1. 用户点发送只该等一个数据库写入。Matrix 那头慢、挂了、限流，跟我们没关系；
 * 2. 挂了要能补发，而不是把那句话永久丢掉；
 * 3. **共享账号要按原发言人分别计数**（对方的三条硬要求之一）—— 排队在这里做最自然：
 *    整条队列按 GAP_MS 平滑拉开，不会攒一批然后在同一毫秒灌给大厅。
 *
 * ## 身份与格式（2026-11-26 对着听雨指南原文核过一遍，改掉了两处想当然）
 *
 * 指南《共享转发账号怎样收发昵称和头像》给的是**正文协议头**这一套：
 *
 *   [ID:清吾];[URL:https://…/avatar.webp]
 *   正文…
 *
 * 1. **`[ID:]` 里放昵称，不是用户 id**。原文：「发送端在 ID 填原昵称」「正文协议以昵称
 *    作为身份键」。我们第一版塞的是 `qingwu-u1`，对方就把人叫成 `qingwu-u1`。
 * 2. **不能再同时发 `org.tea-room.bridge`（v1）**。原文：「听雨当前会优先读有效的 v1 数据，
 *    v1 当前读取 ID、昵称和正文」—— 两套一起发时 v1 会盖掉正文头，而 v1 没有头像字段，
 *    头像就永远打不过去。要头像，只能只发正文头这一套。
 * 3. **`formatted_body` 里不放协议头**：body 给机器读，formatted_body 给人读
 *    （Element 这类客户端优先渲染后者），头露在聊天框里就是那串 `[ID:]`。
 */
import type { Env } from '../types';
import { publicAvatarUrl } from './localAvatar';

/** 站点地址：出站消息的 `site` 字段与相对头像拼绝对地址都用它（rainzt 那边也是带尾斜杠的写法） */
const SITE_FALLBACK = 'https://www.qingwu.ink';

/** 队列里两条之间至少隔这么久 —— 平滑出站，避免同一秒连发一串 */
const GAP_MS = 1200;

/** 单次 flush 最多处理几条（cron 一分钟一次，够用；也避免一轮跑太久） */
const BATCH = 20;

/** 最多重试几次，之后标 failed 等人工看 */
const MAX_TRIES = 6;

/** 待审消息先压一会儿：等审核出结果再决定发不发，别把可能违规的话推到大厅 */
const PENDING_DELAY_MS = 60_000;

export type BridgeCfg = { hs: string; room: string; token: string; site: string };

/** 三个变量齐了才启用；少一个就当没配（本地开发、CI 都是这个状态） */
export function bridgeOf(env: Env): BridgeCfg | null {
  const hs = String(env.MATRIX_HS ?? '').trim().replace(/\/+$/, '');
  const room = String(env.MATRIX_ROOM ?? '').trim();
  const token = String(env.MATRIX_TOKEN ?? '').trim();
  if (!hs || !room || !token) return null;
  const base = String(env.SITE_URL ?? '').trim().replace(/\/+$/, '') || SITE_FALLBACK;
  return { hs, room, token, site: `${base}/` };
}

function rand(n = 10): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}


/**
 * 排队一条出站。
 *
 * 调用点只有 `sendMessage`（本站发的消息）。`pending`（审核中）也入队，但推迟一分钟：
 * 到点由 flush 重新看一眼状态 —— 转正了就发，变成 spam / 撤回了就**悄悄丢掉**。
 * 这样不用去改审核那条链路（judgeLater 里再插一次回调，很容易漏分支）。
 */
export async function queueBridge(
  env: Env,
  opts: { messageId: number; kind: string; status: string },
): Promise<void> {
  if (!bridgeOf(env)) return;
  // 第一阶段只出站文字；图片/语音/文件的格式还要跟对方对（§46.5 第 4 步）
  if (opts.kind !== 'text') return;

  const now = Date.now();
  const delay = opts.status === 'pending' ? PENDING_DELAY_MS : 0;

  // 排在队列末尾：取当前最大的 next_at 再加一个 GAP，保证平滑出站
  const tail = await env.DB.prepare(
    `SELECT MAX(next_at) AS t FROM chat_outbox WHERE status IN ('queued', 'sending')`,
  ).first<{ t: number | null }>();
  const floor = Number(tail?.t ?? 0) > now ? Number(tail!.t) : now;
  const nextAt = floor + (floor === now ? 0 : GAP_MS) + delay;

  await env.DB.prepare(
    `INSERT INTO chat_outbox (message_id, op, txn_id, status, tries, next_at, created_at)
     VALUES (?, 'send', ?, 'queued', 0, ?, ?)`,
  )
    .bind(opts.messageId, `qingwu-${opts.messageId}-${rand(6)}`, nextAt, now)
    .run();
}

export type BridgeRow = {
  body: string;
  nick: string;
  avatar: string;
  accountId: number;
  txn: string;
};

/**
 * 出站报文的**全部格式逻辑**都在这儿（纯函数，好单测）。
 *
 * 格式与取舍见文件头：`[ID:昵称];[URL:头像]` + 换行 + 原文，**不带 v1 结构化**。
 */
export function bridgeContentOf(row: BridgeRow): Record<string, unknown> {
  // 协议头是拿「方括号 + 分号」拼的：昵称里混进这些字符会把对方的解析带偏
  const nick = String(row.nick || '')
    .replace(/[[\]\r\n]/g, '')
    .trim() || '茶客';
  const head = `[ID:${nick}];[URL:${row.avatar}]`;
  // 首行协议头，换行接原话
  const body = `${head}\n${row.body}`;

  return {
    msgtype: 'm.text',
    body,
    format: 'org.matrix.custom.html',
    // 只放正文：协议头是给解析器看的，不该出现在人读的那一版里
    formatted_body: `<p>${esc(row.body).replace(/\n/g, '<br />')}</p>\n`,
    'm.mentions': {},
  };
}

/**
 * URL path 段的严格编码（RFC 3986）。
 *
 * `encodeURIComponent` 会放过 `! ' ( ) *`，而房间 id 恰好是 `!CKQY…` 开头 ——
 * 有的 Matrix 实现（conduit / 某些反代）在 path 里只认 `%21`，不认裸 `!`。
 */
export function pathSeg(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 投递一条。返回 `{err:null, eventId}` 表示成功，否则 err 是失败原因（写进 last_error）。
 *
 * Matrix 的 `PUT /rooms/{id}/send/{type}/{txnId}` 是幂等的（同一个 txnId 重复 PUT
 * 只会产生一条事件），所以超时后重试是安全的 —— 不用自己判「到底发出去没有」。
 * 响应里的 `event_id` 要留下来：那是后面接已读回执（m.receipt）的唯一钥匙。
 */
export async function deliverToMatrix(
  cfg: BridgeCfg,
  row: BridgeRow,
): Promise<{ err: string | null; eventId?: string }> {
  const content = bridgeContentOf(row);

  const url =
    `${cfg.hs}/_matrix/client/v3/rooms/${pathSeg(cfg.room)}` +
    `/send/m.room.message/${pathSeg(row.txn)}`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(content),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { event_id?: string };
      return { err: null, eventId: data.event_id };
    }
    const text = (await res.text().catch(() => '')).slice(0, 200);
    // 4xx 里除了 429 基本是「发了也没用」（房间没了 / token 失效），重试别太多轮
    return { err: `${res.status} ${text}` };
  } catch (err) {
    return { err: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 撤回大厅里的那一条（redact）。
 *
 * 只有出站成功过的消息才有 `matrix_event_id` —— 那是唯一能把「我们库里第几条」
 * 和「大厅里哪个事件」对上号的钥匙。还在队列里没发出去的，由 `queueRedact()` 直接销账。
 *
 * 返回 null 表示成功；否则是失败原因（同样按 chat_outbox 的退避重试）。
 */
export async function redactOnMatrix(cfg: BridgeCfg, eventId: string, txn: string): Promise<string | null> {
  const url =
    `${cfg.hs}/_matrix/client/v3/rooms/${pathSeg(cfg.room)}` +
    `/redact/${pathSeg(eventId)}/${pathSeg(txn)}`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      // reason 会显示在 Matrix 客户端里，别写内部术语
      body: JSON.stringify({ reason: '作者撤回了这条消息' }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return null;
    const text = (await res.text().catch(() => '')).slice(0, 200);
    return `${res.status} ${text}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * 撤回时排一条 redact 任务。
 *
 * 两种情况分开处理：
 * - **还没发出去**（`matrix_event_id` 为空）：直接从队列里删掉那条 send —— 大厅里
 *   从没出现过，再 redact 就是打一个不存在的事件；
 * - **已经发出去了**：入队 `op='redact'`，由 flush 按同样的平滑节奏去撤。
 *
 * 调用点是「作者撤回」和「站长/AI 收走」——凡是不该继续留在大厅的都要走这儿。
 */
export async function queueRedact(env: Env, messageId: number): Promise<void> {
  if (!bridgeOf(env)) return;

  const row = await env.DB.prepare(
    `SELECT matrix_event_id AS ev FROM chat_messages WHERE id = ?`,
  )
    .bind(messageId)
    .first<{ ev: string | null }>();

  if (!row?.ev) {
    await env.DB.prepare(
      `DELETE FROM chat_outbox WHERE message_id = ? AND status = 'queued'`,
    )
      .bind(messageId)
      .run();
    return;
  }

  // 已经排过 redact 就不用重复排（连点两下撤回、或者撤回后又删）
  const dup = await env.DB.prepare(
    `SELECT id FROM chat_outbox WHERE message_id = ? AND op = 'redact' AND status IN ('queued','sending','done')`,
  )
    .bind(messageId)
    .first<{ id: number }>();
  if (dup) return;

  const now = Date.now();
  const tail = await env.DB.prepare(
    `SELECT MAX(next_at) AS t FROM chat_outbox WHERE status IN ('queued', 'sending')`,
  ).first<{ t: number | null }>();
  const floor = Number(tail?.t ?? 0) > now ? Number(tail!.t) : now;
  const nextAt = floor + (floor === now ? 0 : GAP_MS);

  await env.DB.prepare(
    `INSERT INTO chat_outbox (message_id, op, txn_id, status, tries, next_at, created_at)
     VALUES (?, 'redact', ?, 'queued', 0, ?, ?)`,
  )
    .bind(messageId, `qingwu-r-${messageId}-${rand(6)}`, nextAt, now)
    .run();
}

/**
 * 补发队列（scheduled 每分钟一次；发送成功时也会立刻催一次）。
 *
 * 两支队伍走同一个队列，按 `op` 分流：
 * - `send`：只有**仍然是 visible 的文字**才出门 —— 消息可能在这中间被作者撤回、
 *   被 AI 收起、被站长删掉，那些都不该再去打扰大厅；
 * - `redact`：反过来，**只有确实出站过**的才撤；本来就没发出去的直接销账。
 */
export async function flushBridge(env: Env, limit = BATCH): Promise<{ sent: number; dropped: number; failed: number }> {
  const cfg = bridgeOf(env);
  if (!cfg) return { sent: 0, dropped: 0, failed: 0 };

  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT o.id AS oid, o.op AS op, o.txn_id AS txn, o.tries AS tries,
            m.id AS mid, m.body AS body, m.kind AS kind, m.status AS status,
            m.account_id AS account_id, m.matrix_event_id AS ev,
            a.display_name AS nick, a.avatar_url AS avatar, a.email AS email
       FROM chat_outbox o
       JOIN chat_messages m ON m.id = o.message_id
       LEFT JOIN accounts a ON a.id = m.account_id
      WHERE o.status = 'queued' AND o.next_at <= ?
      ORDER BY o.id
      LIMIT ?`,
  )
    .bind(now, limit)
    .all();

  const list = (rows.results ?? []) as {
    oid: number;
    op: string;
    txn: string;
    tries: number;
    mid: number;
    body: string;
    kind: string;
    status: string;
    account_id: number;
    ev: string | null;
    nick: string | null;
    avatar: string | null;
    email: string | null;
  }[];

  let sent = 0;
  let dropped = 0;
  let failed = 0;

  for (const r of list) {
    // ⚠️ 先用 op 分流，再谈状态：撤回任务对应的消息状态本来就是 recalled/deleted，
    //    不能拿 send 的「必须 visible」去筛它，否则撤回头永远发不出去。
    if (r.op === 'redact') {
      if (!r.ev) {
        // 从没出站过（或者出站失败了）⇒ 大厅里没有这条，任务直接销账
        await env.DB.prepare(`DELETE FROM chat_outbox WHERE id = ?`).bind(r.oid).run();
        dropped += 1;
        continue;
      }

      const claimed = await env.DB.prepare(
        `UPDATE chat_outbox SET status = 'sending' WHERE id = ? AND status = 'queued'`,
      )
        .bind(r.oid)
        .run();
      if (!changed(claimed)) continue;

      const err = await redactOnMatrix(cfg, r.ev, r.txn);
      if (err === null) {
        await env.DB.prepare(`UPDATE chat_outbox SET status = 'done', last_error = NULL WHERE id = ?`)
          .bind(r.oid)
          .run();
        sent += 1;
        continue;
      }

      const tries = r.tries + 1;
      if (tries >= MAX_TRIES) {
        await env.DB.prepare(
          `UPDATE chat_outbox SET status = 'failed', tries = ?, last_error = ? WHERE id = ?`,
        )
          .bind(tries, err.slice(0, 300), r.oid)
          .run();
      } else {
        const backoff = Math.min(20_000 * 2 ** (tries - 1), 600_000);
        await env.DB.prepare(
          `UPDATE chat_outbox SET status = 'queued', tries = ?, next_at = ?, last_error = ? WHERE id = ?`,
        )
          .bind(tries, Date.now() + backoff, err.slice(0, 300), r.oid)
          .run();
      }
      failed += 1;
      continue;
    }

    // 已经不可见 / 不是文字 ⇒ 不用发了，直接从队列里去掉
    if (r.status !== 'visible' || r.kind !== 'text') {
      await env.DB.prepare(`DELETE FROM chat_outbox WHERE id = ?`).bind(r.oid).run();
      dropped += 1;
      continue;
    }

    // 占位，避免并发两轮同时发同一条（cron 与「发送后立刻催一次」会撞）
    const claimed = await env.DB.prepare(
      `UPDATE chat_outbox SET status = 'sending' WHERE id = ? AND status = 'queued'`,
    )
      .bind(r.oid)
      .run();
    if (!changed(claimed)) continue;

    // 昵称要准：正文协议头的 `[ID:]` 就是它。display_name 为空时别退回邮箱前缀
    // （那等于把邮箱贴到大厅），给个中性兜底。
    const nick = (r.nick || '').trim() || `茶客#${r.account_id}`;
    /**
     * 头像走我们自己的域名（`/api/chat/avatar/u/<id>`），不走 `avatarFromEmail()` 那张：
     * `q.qlogo.cn` 在境外回 400（自家香港机实测），对方加载不了；而且那个 URL 的
     * `dst_uin` 是明文 QQ 号。细节见 `localAvatar.ts`。
     */
    const avatar = publicAvatarUrl(cfg.site, r.account_id);
    const got = await deliverToMatrix(cfg, {
      body: r.body,
      nick,
      avatar,
      accountId: r.account_id,
      txn: r.txn,
    });

    if (got.err === null) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE chat_outbox SET status = 'done', last_error = NULL WHERE id = ?`).bind(r.oid),
        // matrix_event_id 是已读回执的钥匙：/sync 回来的 m.receipt 按 event id 指认
        env.DB.prepare(`UPDATE chat_messages SET matrix_txn_id = ?, matrix_event_id = ? WHERE id = ?`).bind(
          r.txn,
          got.eventId ?? null,
          r.mid,
        ),
      ]);
      sent += 1;
      continue;
    }

    const err = got.err;

    const tries = r.tries + 1;
    if (tries >= MAX_TRIES) {
      await env.DB.prepare(
        `UPDATE chat_outbox SET status = 'failed', tries = ?, last_error = ? WHERE id = ?`,
      )
        .bind(tries, err.slice(0, 300), r.oid)
        .run();
    } else {
      // 20s → 40s → 80s → … 封顶 10 分钟
      const backoff = Math.min(20_000 * 2 ** (tries - 1), 600_000);
      await env.DB.prepare(
        `UPDATE chat_outbox SET status = 'queued', tries = ?, next_at = ?, last_error = ? WHERE id = ?`,
      )
        .bind(tries, Date.now() + backoff, err.slice(0, 300), r.oid)
        .run();
    }
    failed += 1;
  }

  return { sent, dropped, failed };
}

/** D1 的 run() 返回 meta.changes；用它判断「这一行是不是我抢到的」 */
function changed(res: { meta?: { changes?: number } } | undefined | null): boolean {
  return Number(res?.meta?.changes ?? 0) > 0;
}
