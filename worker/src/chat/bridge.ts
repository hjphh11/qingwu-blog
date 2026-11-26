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
 * ## 身份
 *
 * `actor.id = qingwu-u<accountId>`，**不用昵称** —— 改名换头像不该产生新身份。
 * 正文首行另外放一份 `[ID:…];[URL:…]`（§46.4 的双格式）：对方前端目前只读结构化里的
 * id / nick / text，头像只能靠正文头还原，所以协议头不能省。
 */
import type { Env } from '../types';
import { avatarFromEmail } from '../auth/avatar';

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

/** 头像可能是 `/images/...` 这种站内相对路径，Matrix 那头需要绝对地址 */
function absUrl(u: string, site: string): string {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const base = site.replace(/\/+$/, '');
  return base + (s.startsWith('/') ? s : `/${s}`);
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
 * 双格式是 §46.4 定的：正文首行 `[ID:…];[URL:…]` 给「只读得懂正文」的客户端，
 * `org.tea-room.bridge` 给对方的解析器。两边的 `text` 都必须是**原始正文**，
 * 不能带协议头 —— 不然对方前端会把 `[ID:…]` 当成人说的话显示出来。
 */
export function bridgeContentOf(cfg: BridgeCfg, row: BridgeRow): Record<string, unknown> {
  const idKey = `qingwu-u${row.accountId}`;
  const head = `[ID:${idKey}];[URL:${row.avatar}]`;
  // 正文首行放协议头，换行接原话
  const body = `${head}\n${row.body}`;

  return {
    msgtype: 'm.text',
    body,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>${esc(head)}</p>\n<p>${esc(row.body).replace(/\n/g, '<br />')}</p>\n`,
    'm.mentions': {},
    'org.tea-room.bridge': {
      actor: { id: idKey, nick: row.nick },
      site: cfg.site,
      text: row.body,
      transactionId: row.txn,
      version: 1,
    },
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
  const content = bridgeContentOf(cfg, row);

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
 * 补发队列（scheduled 每分钟一次；发送成功时也会立刻催一次）。
 *
 * 只有**仍然是 visible 的文字消息**才会出门 —— 消息可能在这中间被作者撤回、
 * 被 AI 收起、被站长删掉，那些都不该再去打扰大厅。
 */
export async function flushBridge(env: Env, limit = BATCH): Promise<{ sent: number; dropped: number; failed: number }> {
  const cfg = bridgeOf(env);
  if (!cfg) return { sent: 0, dropped: 0, failed: 0 };

  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT o.id AS oid, o.txn_id AS txn, o.tries AS tries,
            m.id AS mid, m.body AS body, m.kind AS kind, m.status AS status,
            m.account_id AS account_id,
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
    txn: string;
    tries: number;
    mid: number;
    body: string;
    kind: string;
    status: string;
    account_id: number;
    nick: string | null;
    avatar: string | null;
    email: string | null;
  }[];

  let sent = 0;
  let dropped = 0;
  let failed = 0;

  for (const r of list) {
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

    const nick = r.nick || (r.email ? r.email.split('@')[0]! : `茶客#${r.account_id}`);
    /**
     * 头像要跟站内显示的那张**完全一致**：多数账号 `avatar_url` 是空的，
     * 站内走的是 `avatarFromEmail()`（QQ 邮箱取 qlogo、其余取 cravatar）。
     * 只取 `avatar_url` 会让出站消息变成空头像 —— 而协议头里的 `[URL:]` 正是
     * 对方还原头像的唯一来源，空了对面就只剩一个色块。
     */
    const avatar = r.avatar || (r.email ? avatarFromEmail(r.email) : '');
    const got = await deliverToMatrix(cfg, {
      body: r.body,
      nick,
      avatar: absUrl(avatar, cfg.site),
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
