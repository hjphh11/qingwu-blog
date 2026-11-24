// 长亭 · 消息（读 / 发 / 轮询 / 已读）
//
// 接口（对外 /api/chat/*，nginx 去前缀后到这里）：
//   GET  /chat/history?before=<id>&limit=50
//   GET  /chat/poll?after=<id>
//   POST /chat/send
//   POST /chat/read
//
// 三条设计约束：
//   · **发送路径上不能查第二次库**：账号资料 + 最近 5 条 + 1 分钟条数 + 累计条数
//     一次性查出来喂给 screen()，否则每条消息要多花 4 次往返
//   · **审核不能挡发送**：judge 走 ctx.waitUntil，前端 100ms 内就该看到自己的话
//   · **hold 必须能放出来**：pending 转 visible 后光靠 `id > after` 是拉不到的
//     （id 早涨过去了），所以 poll 额外查一次「30 秒内状态变更过」的消息

import type { Env } from '../types';
import { json, plainOf } from '../util';
import { visitorKey } from '../visitor';
import { avatarFromEmail, avatarFromHash } from '../auth/avatar';
import { sessionUser, type AccountRow } from '../auth/store';
import { moderateComment } from '../admin/ai';
import { screen, type ScreenCtx } from './screen';

/** 正文上限。和 screen.ts 的 MAX_BODY 对齐 —— 那边是审核判据，这里是硬校验 */
const BODY_MAX = 500;

/** 单次 poll 最多带多少条。超过这个数说明前端落后太久，让它走 history */
const POLL_MAX = 100;

/** 在线判定窗口 */
const ONLINE_WINDOW = 5 * 60 * 1000;

/** presence 写入节流：同一人 20 秒内只写一次，否则 2.5 秒一轮会把库写热 */
const PRESENCE_THROTTLE = 20 * 1000;

/** 补发窗口：状态在这么久之内变更过的消息，poll 要重新下发一次 */
const RELEASE_WINDOW = 30 * 1000;

// ——————————————————————————————————————————————————————————
// 小工具
// ——————————————————————————————————————————————————————————

/**
 * 当前账号。
 *
 * 与 comments.ts 同口径：返回 `AccountRow`（已登录）/ `null`（没登录）/
 * `undefined`（身份表还没迁移）。`undefined` 时按未登录处理 —— 聊天室比评论区更严格，
 * 未登录本来就只能读，没有必要为「迁移没跑完」开一个匿名口子。
 */
async function currentAccount(request: Request, env: Env): Promise<AccountRow | null | undefined> {
  try {
    return (await sessionUser(request, env))?.account ?? null;
  } catch {
    return undefined;
  }
}

/**
 * 友链域名集合（外链白名单用）。
 *
 * 从 `link_feeds` 现算而不是写死在 words.ts —— 加了新友链，白名单自动跟着变。
 * 模块级缓存 10 分钟：这组数据几分钟内不会变，不必每条消息查一次。
 */
let hostCache: { set: Set<string>; at: number } | null = null;

async function trustedHosts(env: Env): Promise<Set<string>> {
  const now = Date.now();
  if (hostCache && now - hostCache.at < 10 * 60 * 1000) return hostCache.set;

  const set = new Set<string>();
  try {
    const rows = await env.DB.prepare('SELECT url FROM link_feeds').all<{ url: string }>();
    for (const r of rows.results ?? []) {
      const h = String(r.url || '').toLowerCase().replace(/^www\./, '');
      if (h) set.add(h);
    }
  } catch {
    /* 表不存在 / 查挂了都当没有：外链一律 flag，只是个优先级，不影响能否发出去 */
  }
  hostCache = { set, at: now };
  return set;
}

/** 消息对外的样子（字段名与 src/lib/chat.ts 的 ChatMessage 对齐） */
interface MessageRow {
  id: number;
  account_id: number | null;
  body: string;
  status: string;
  ts: number;
  origin: string;
  remote_nick: string | null;
  remote_avatar: string | null;
  remote_site: string | null;
  acc_name: string | null;
  acc_avatar: string | null;
  acc_role: string | null;
  acc_site: string | null;
  /** 邮箱前缀 —— display_name 为空时的署名兜底（与 comments.ts 的口径一致） */
  acc_prefix: string | null;
  email_hash: string | null;
}

const COLS = `m.id, m.account_id, m.body, m.status, m.ts, m.origin,
              m.remote_nick, m.remote_avatar, m.remote_site,
              a.display_name AS acc_name, a.avatar_url AS acc_avatar,
              a.role AS acc_role, a.site_url AS acc_site, a.email_hash AS email_hash,
              substr(a.email, 1, instr(a.email, '@') - 1) AS acc_prefix`;

/**
 * 可见性：正常消息人人可见；pending **只有发送者自己**可见。
 * spam / deleted 谁都不给（后台另走 /admin）。
 */
function visibleClause(me: string | number): { sql: string; params: Array<string | number> } {
  return {
    sql: `(m.status IN ('visible','recalled') OR (m.status = 'pending' AND m.account_id = ?))`,
    params: [me],
  };
}

/** 一条消息上的表情回应汇总（一种表情一行） */
export interface Reaction {
  emoji: string;
  n: number;
  /** 我自己点没点 */
  mine: boolean;
}

/**
 * 批量取这批消息的表情回应。
 *
 * 为什么一次查完而不是逐条：一屏 30 条、轮询 100 条，逐条查就是 30~100 次往返。
 * `IN (...)` 一次拿全，再在内存里按 message_id 分组。
 */
async function loadReactions(
  env: Env,
  ids: number[],
  meId: number | null,
): Promise<Map<number, Reaction[]>> {
  const map = new Map<number, Reaction[]>();
  if (!ids.length) return map;

  try {
    const ph = ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT message_id, emoji, COUNT(*) AS n,
              MAX(CASE WHEN account_id = ? THEN 1 ELSE 0 END) AS mine
         FROM chat_reactions WHERE message_id IN (${ph})
        GROUP BY message_id, emoji
        ORDER BY n DESC, emoji ASC`,
    )
      .bind(meId ?? -1, ...ids)
      .all<{ message_id: number; emoji: string; n: number; mine: number }>();

    for (const r of rows.results ?? []) {
      const list = map.get(r.message_id) ?? [];
      list.push({ emoji: r.emoji, n: r.n, mine: r.mine === 1 });
      map.set(r.message_id, list);
    }
  } catch {
    /* 表不存在 / 查挂了都当没有：回应是锦上添花，不该让消息列表整个挂掉 */
  }
  return map;
}

function toItem(
  r: MessageRow,
  meId: number | null,
  reactions: Reaction[] = [],
): Record<string, unknown> {
  const remote = r.origin === 'remote';
  // 本地消息三档头像兜底：账号档案 → 邮箱哈希现拼（和评论同一套，不返回 emailHash 本身）
  const avatar = remote
    ? r.remote_avatar || ''
    : r.acc_avatar || avatarFromHash(r.email_hash || '');
  /**
   * 署名兜底顺序：档案 display_name → 邮箱前缀 → 茶客#id。
   *
   * 中间那档不能省：注册时 display_name 是 null，只留「茶客#1」的话，
   * 整个长亭里所有人长得都一样（和评论区 `author` 的口径保持一致）。
   */
  const name = remote
    ? r.remote_nick || '远方的茶客'
    : r.acc_name || r.acc_prefix || `茶客#${r.account_id ?? 0}`;

  return {
    id: r.id,
    name,
    avatar,
    site: remote ? r.remote_site || '' : r.acc_site || '',
    admin: !remote && (r.acc_role ?? '') === 'admin',
    body: r.body,
    at: new Date(r.ts).toISOString(),
    status: r.status === 'recalled' ? 'recalled' : r.status === 'pending' ? 'pending' : 'visible',
    mine: meId !== null && r.account_id === meId,
    origin: remote ? 'remote' : 'local',
    reactions,
  };
}

function onlineOf(env: Env, now: number): Promise<number> {
  return env.DB.prepare('SELECT COUNT(*) AS n FROM chat_presence WHERE last_seen > ?')
    .bind(now - ONLINE_WINDOW)
    .first<{ n: number }>()
    .then((r) => r?.n ?? 0)
    .catch(() => 0);
}

/** 谁在读（写节流版）：只有超过 20 秒没记过才写 */
export async function touchPresence(env: Env, accountId: number, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO chat_presence (account_id, last_seen) VALUES (?, ?)
       ON CONFLICT(account_id) DO UPDATE SET last_seen = excluded.last_seen
       WHERE chat_presence.last_seen < ?`,
  )
    .bind(accountId, now, now - PRESENCE_THROTTLE)
    .run()
    .catch(() => undefined);
}

// ——————————————————————————————————————————————————————————
// GET /chat/history —— 首屏 / 向上翻页（按 id 倒序取，返回时转正序）
// ——————————————————————————————————————————————————————————
export async function getHistory(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const asked = Number.parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 50) : 30;
  const before = Number(url.searchParams.get('before') || '') || 0;

  const me = await currentAccount(request, env);
  const meId = me?.id ?? null;
  const vis = visibleClause(meId ?? -1);

  try {
    const older = before > 0 ? ' AND m.id < ?' : '';
    const stmt = env.DB.prepare(
      `SELECT ${COLS} FROM chat_messages m LEFT JOIN accounts a ON a.id = m.account_id
        WHERE ${vis.sql}${older}
        ORDER BY m.id DESC LIMIT ?`,
    );
    const rows = before > 0
      ? await stmt.bind(...vis.params, before, limit + 1).all<MessageRow>()
      : await stmt.bind(...vis.params, limit + 1).all<MessageRow>();

    const fetched = rows.results ?? [];
    const hasMore = fetched.length > limit;
    const page = hasMore ? fetched.slice(0, limit) : fetched;

    // 我读到哪儿了 —— 前端据此画「上次看到这里」
    let lastRead = 0;
    if (meId) {
      const r = await env.DB.prepare('SELECT last_read_id FROM chat_reads WHERE account_id = ?')
        .bind(meId)
        .first<{ last_read_id: number }>();
      lastRead = r?.last_read_id ?? 0;
    }

    const reacts = await loadReactions(env, page.map((r) => r.id), meId);

    return json({
      ok: true,
      // 库里是倒序取的，给前端翻回正序 —— 渲染顺序由数据决定，前端不再 sort
      messages: page.reverse().map((r) => toItem(r, meId, reacts.get(r.id))),
      hasMore,
      nextBefore: page[0]?.id ?? 0,
      lastRead,
      online: await onlineOf(env, Date.now()),
      auth: { signedIn: Boolean(me), canSend: Boolean(me) },
    });
  } catch (err) {
    console.error('[chat] history 失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '聊天记录暂时读不出来' }, 502);
  }
}

// ——————————————————————————————————————————————————————————
// GET /chat/poll —— 增量
// ——————————————————————————————————————————————————————————
export async function pollChat(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const after = Number(url.searchParams.get('after') || '') || 0;
  const now = Date.now();

  const me = await currentAccount(request, env);
  const meId = me?.id ?? null;
  const vis = visibleClause(meId ?? -1);

  try {
    /**
     * 兜底清理：超过 60 秒还卡在 pending 的消息放出来。
     *
     * 为什么需要：waitUntil 不是「保证执行」—— worker 重启、机器重启、
     * judge 超时没兜住，都会留下一条只有发送者自己可见的孤儿消息。
     * 让它在无人值守时也能自己恢复，比写一个定时任务去扫更简单。
     */
    await env.DB.prepare(
      `UPDATE chat_messages SET status = 'visible', updated_at = ?
        WHERE status = 'pending' AND ts < ?`,
    )
      .bind(now, now - 60 * 1000)
      .run()
      .catch(() => undefined);

    // ① 新消息
    const fresh = await env.DB.prepare(
      `SELECT ${COLS} FROM chat_messages m LEFT JOIN accounts a ON a.id = m.account_id
        WHERE m.id > ? AND ${vis.sql}
        ORDER BY m.id ASC LIMIT ?`,
    )
      .bind(after, ...vis.params, POLL_MAX)
      .all<MessageRow>();

    /**
     * ② 状态刚变更过的（≤ after 的那批）
     *
     * 两种用途：
     *   · pending 转 visible → 当新消息补发（否则别人永远看不到这条）
     *   · 转 recalled / deleted → 进 recalled 数组，让前端把它从屏幕上摘掉
     *
     * 只查 30 秒窗口，所以不会无限重发；前端那侧再按 id 去重兜一层。
     */
    const changed = await env.DB.prepare(
      `SELECT ${COLS} FROM chat_messages m LEFT JOIN accounts a ON a.id = m.account_id
        WHERE m.updated_at > ? AND m.id <= ?
          AND (m.status IN ('visible','recalled','deleted') OR (m.status='pending' AND m.account_id = ?))
        ORDER BY m.id ASC LIMIT 50`,
    )
      .bind(now - RELEASE_WINDOW, after, meId ?? -1)
      .all<MessageRow>();

    const freshList = fresh.results ?? [];
    const changedList = changed.results ?? [];

    // 已经作为「新消息」下发的，别在 changed 里再来一遍
    const freshIds = new Set(freshList.map((r) => r.id));
    const released: MessageRow[] = [];
    const recalled: number[] = [];
    for (const r of changedList) {
      if (freshIds.has(r.id)) continue;
      if (r.status === 'visible' || r.status === 'pending') released.push(r);
      else recalled.push(r.id);
    }

    // 在线人数：能投票说明人就在页面上
    if (meId) await touchPresence(env, meId, now);

    const all = [...freshList, ...released];
    const reacts = await loadReactions(env, all.map((r) => r.id), meId);

    return json({
      ok: true,
      messages: all.map((r) => toItem(r, meId, reacts.get(r.id))),
      recalled,
      online: await onlineOf(env, now),
      auth: { signedIn: Boolean(me), canSend: Boolean(me) },
    });
  } catch (err) {
    console.error('[chat] poll 失败:', err instanceof Error ? err.message : err);
    // poll 失败不弹错误：下一次 2.5 秒后就会重试，弹窗只会让人以为聊天坏了
    return json({ ok: false, reason: 'storage', messages: [], recalled: [] }, 502);
  }
}

// ——————————————————————————————————————————————————————————
// POST /chat/send
// ——————————————————————————————————————————————————————————
/** 记一条规则命中（失败无所谓，统计不是关键路径） */
async function bumpRules(env: Env, hits: string[], now: number): Promise<void> {
  if (!hits.length) return;
  try {
    await env.DB.batch(
      hits.map((id) =>
        env.DB.prepare(
          `INSERT INTO chat_rule_stats (rule_id, hits, updated_at) VALUES (?, 1, ?)
             ON CONFLICT(rule_id) DO UPDATE SET hits = hits + 1, updated_at = excluded.updated_at`,
        ).bind(id, now),
      ),
    );
  } catch {
    /* 统计表没建 / 写挂了都不该影响发送 */
  }
}

export async function sendMessage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let payload: { body?: unknown };
  try {
    payload = (await request.json()) as { body?: unknown };
  } catch {
    return json({ ok: false, reason: 'bad_request', message: '请求格式不对' }, 400);
  }

  const me = await currentAccount(request, env);
  // 文案不复用 loginRequiredMessage()：那句是给留言板写的（「登录之后才能留言」），
  // 聊天室里说「留言」会让人以为是另一个功能
  if (!me) {
    return json(
      {
        ok: false,
        reason: 'login_required',
        message: '登录之后才能一起聊 —— 用邮箱收个验证码就行',
      },
      401,
    );
  }

  const body = String(payload.body ?? '').trim();
  if (!body) return json({ ok: false, reason: 'empty', message: '说点什么吧' }, 400);
  if (body.length > BODY_MAX) {
    return json({ ok: false, reason: 'too_long', message: `最多 ${BODY_MAX} 个字` }, 400);
  }

  const now = Date.now();

  try {
    /**
     * 一次查库拿齐 screen() 要的全部上下文。
     *
     * 三条子查询合成一次往返：最近 5 条（含时间戳）、1 分钟条数、累计条数。
     * 分三次查的话，每条消息多 2 次 DB 往返 —— 在发送路径上不划算。
     */
    const [recent, counts] = await Promise.all([
      env.DB.prepare(
        'SELECT body, ts FROM chat_messages WHERE account_id = ? ORDER BY id DESC LIMIT 5',
      )
        .bind(me.id)
        .all<{ body: string; ts: number }>(),
      env.DB.prepare(
        `SELECT
           SUM(CASE WHEN ts > ? THEN 1 ELSE 0 END) AS minute_count,
           COUNT(*) AS total
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
    ctx.waitUntil(bumpRules(env, verdict.hits, now));

    // —— block：不落库，安静地退回 —— 
    if (verdict.action === 'block') {
      if (verdict.banMinutes) {
        ctx.waitUntil(
          env.DB.prepare(
            'INSERT INTO chat_bans (account_id, until, reason, created_at) VALUES (?, ?, ?, ?)',
          )
            .bind(me.id, now + verdict.banMinutes * 60_000, `auto:${verdict.hits.join(',')}`, now)
            .run()
            .catch(() => undefined),
        );
      }
      return json({ ok: false, reason: 'screened', message: verdict.reason });
    }

    // hold → pending（只有自己可见）；flag / pass → visible
    const status = verdict.action === 'hold' ? 'pending' : 'visible';

    const res = await env.DB.prepare(
      `INSERT INTO chat_messages (account_id, body, status, ts, updated_at, ip_hash, origin)
       VALUES (?, ?, ?, ?, ?, ?, 'local')`,
    )
      .bind(me.id, body, status, now, now, await visitorKey(request, env).catch(() => null))
      .run();

    const id = Number(res.meta.last_row_id);

    /**
     * 异步审核 —— **不在请求路径上**。
     *
     * 判定失败一律放行（宁可漏一条，也不能让聊天室收不到话）；
     * hold 的消息在这里转正，或者转 spam。
     * flag / pass 的也判，命中就摘掉（前端下一次 poll 收到 recalled）。
     */
    if (!verdict.skipJudge) {
      ctx.waitUntil(
        judgeLater(env, {
          id,
          body,
          author: me.display_name || me.email.split('@')[0] || '茶客',
          wasPending: status === 'pending',
        }),
      );
    }

    return json({
      ok: true,
      message: {
        id,
        // 和 toItem 的兜底顺序一致，否则「刚发的这条」和「刷新后看到的那条」署名不一样
        name: me.display_name || me.email.split('@')[0] || `茶客#${me.id}`,
        avatar: me.avatar_url || avatarFromEmail(me.email),
        site: me.site_url || '',
        admin: me.role === 'admin',
        body,
        at: new Date(now).toISOString(),
        // 前端据 status 决定画不画「等一等」的小标
        status: status === 'pending' ? 'pending' : 'visible',
        mine: true,
        origin: 'local',
      },
      /** 命中了哪些规则（只回条数，不回 id —— 别给出一份规避说明书） */
      screened: verdict.hits.length > 0,
    });
  } catch (err) {
    console.error('[chat] send 失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '这条没能发出去，稍后再试' }, 502);
  }
}

/** 后台判定：命中转 spam，没命中把 pending 放出来 */
async function judgeLater(
  env: Env,
  msg: { id: number; body: string; author: string; wasPending: boolean },
): Promise<void> {
  try {
    const mod = await moderateComment(env, {
      id: msg.id,
      author: msg.author,
      body: plainOf(msg.body),
      path: '/chat/',
      replies: [],
    });

    const now = Date.now();
    if (mod?.hit) {
      await env.DB.prepare(
        `UPDATE chat_messages SET status = 'spam', updated_at = ? WHERE id = ?`,
      )
        .bind(now, msg.id)
        .run();
      return;
    }

    // 没命中：hold 的转正（前端 poll 会把它补发出去）
    if (msg.wasPending) {
      await env.DB.prepare(
        `UPDATE chat_messages SET status = 'visible', updated_at = ? WHERE id = ? AND status = 'pending'`,
      )
        .bind(now, msg.id)
        .run();
    }
  } catch (err) {
    // judge 挂了 → 放行。hold 的消息不能因为上游抖动就永远只有自己看得见
    console.warn('[chat] 审核失败，放行:', err instanceof Error ? err.message : err);
    if (msg.wasPending) {
      await env.DB.prepare(
        `UPDATE chat_messages SET status = 'visible', updated_at = ? WHERE id = ? AND status = 'pending'`,
      )
        .bind(Date.now(), msg.id)
        .run()
        .catch(() => undefined);
    }
  }
}

// ——————————————————————————————————————————————————————————
// POST /chat/read —— 更新阅读游标
// ——————————————————————————————————————————————————————————
export async function markRead(request: Request, env: Env): Promise<Response> {
  const me = await currentAccount(request, env);
  if (!me) return json({ ok: true }); // 未登录不用记，前端也不会画那条线

  let lastId = 0;
  try {
    const body = (await request.json()) as { lastId?: unknown };
    lastId = Number(body.lastId) || 0;
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }
  if (lastId <= 0) return json({ ok: true });

  try {
    await env.DB.prepare(
      `INSERT INTO chat_reads (account_id, last_read_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET last_read_id = excluded.last_read_id,
                                              updated_at = excluded.updated_at
         WHERE chat_reads.last_read_id < excluded.last_read_id`,
    )
      .bind(me.id, lastId, Date.now())
      .run();
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}
