// 清吾 · 后台「运行与设置」—— 状态汇总
//
// 这一个页面的职责只有一件：**把散在各张表里的状态一次说完**。
// 在此之前这些数字只能靠 ssh 上去 sqlite3 一条条敲，或者对着日志猜：
//   · 两条 AI 通道到底哪条开着、今天烧了多少、key 到底能不能用；
//   · 小爱今天自动回了几条、跳过几条、为什么跳过；
//   · 友链有多少条申请卡在待审、多少站找不到回链、多少站失联倒计时中；
//   · 发信队列有没有积压、积压多久了；
//   · 打点还活着吗（lastHit 是实时的，链路一断立刻能看出来）。
//
// —— 三条纪律 ——
// 1) **只读**。除了 ping 会花掉一点 AI 配额，这个模块不写任何一张表。
// 2) **表不存在不算错**。所有查询都走 rows()，失败记进 warnings 继续往下跑 ——
//    迁移动没跑是「状态」的一部分，不该让整页 500。
// 3) **不调 GitHub**。links.json 在仓库里，读它要走 Contents API（慢且会失败），
//    这是「运行状态」页，不是「内容」页 —— 友链数看 applications + friend_status 就够。
//
// 路由：
//   GET  /admin/status        全部状态
//   POST /admin/status/ping   真打一次两条 AI 通道

import type { Env } from '../types';
import { dayKey, json } from '../util';
import { aiSnapshot, autoReplyConfig, pingChannels } from './ai';
import type { Admin } from './auth';
// 每页条数的白名单跟收件箱共用一份，免得两页给用户不同的选项
import { PAGE_SIZES } from './comments';

const DAY_MS = 86_400_000;
/** 北京时间当日 0 点（毫秒）。与 util.dayKey 同一口径（固定 +8，无夏令时）。 */
function dayStartMs(now = Date.now()): number {
  return Math.floor((now + 8 * 3_600_000) / DAY_MS) * DAY_MS - 8 * 3_600_000;
}

/**
 * 读一组行。**任何异常都吞掉并记进 warnings** ——
 * 迁移没跑 / 表被删 / schema 变了，都不该让状态页整页崩。
 */
async function rows<T>(env: Env, warnings: string[], sql: string, ...binds: unknown[]): Promise<T[]> {
  try {
    const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
    const r = await stmt.all<T>();
    return r.results ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 只留一句可读的，别把整条 SQL 贴给前端
    warnings.push(`${sql.replace(/\s+/g, ' ').trim().slice(0, 48)}… → ${msg.slice(0, 90)}`);
    return [];
  }
}

type CountRow = { k: string | null; n: number };

function toMap(list: CountRow[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of list) m[String(r.k ?? '')] = Number(r.n ?? 0);
  return m;
}

// ——————————————————————————————————————————————————————————
// GET /admin/status
// ——————————————————————————————————————————————————————————
export async function getStatus(_request: Request, env: Env, _admin: Admin): Promise<Response> {
  const now = Date.now();
  const day = dayKey(now);
  const from7 = dayKey(now - 6 * DAY_MS);
  const dayStart = dayStartMs(now);
  const warnings: string[] = [];

  const [
    ai,
    commentStatus,
    commentToday,
    commentNoReply,
    appsByStatus,
    backlinkRows,
    friendStates,
    replyToday,
    replyWeek,
    autoLogCount,
    usageWeek,
    mailRows,
    hitToday,
    hitLast,
    sessionRows,
  ] = await Promise.all([
    aiSnapshot(env),

    rows<CountRow>(env, warnings, 'SELECT status AS k, COUNT(*) AS n FROM comments GROUP BY status'),

    rows<{ n: number }>(
      env,
      warnings,
      'SELECT COUNT(*) AS n FROM comments WHERE ts >= ?',
      dayStart,
    ),

    // 「发出了但没人回」的顶层留言：状态可见、且没有任何未删除的子回复
    rows<{ n: number }>(
      env,
      warnings,
      `SELECT COUNT(*) AS n FROM comments c
        WHERE c.parent_id IS NULL AND c.status = 'visible'
          AND NOT EXISTS (
            SELECT 1 FROM comments r WHERE r.parent_id = c.id AND r.status != 'deleted'
          )`,
    ),

    rows<CountRow>(
      env,
      warnings,
      'SELECT status AS k, COUNT(*) AS n FROM applications GROUP BY status',
    ),

    rows<{ total: number; broken: number; errored: number }>(
      env,
      warnings,
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS broken,
              SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) AS errored
         FROM backlink_checks`,
    ),

    rows<CountRow>(env, warnings, 'SELECT state AS k, COUNT(*) AS n FROM friend_status GROUP BY state'),

    rows<CountRow>(
      env,
      warnings,
      'SELECT action AS k, COUNT(*) AS n FROM auto_reply_log WHERE day = ? GROUP BY action',
      day,
    ),

    rows<{ day: string; action: string; n: number }>(
      env,
      warnings,
      `SELECT day, action, COUNT(*) AS n FROM auto_reply_log
        WHERE day >= ? GROUP BY day, action ORDER BY day`,
      from7,
    ),

    // 流水只取总数。**列表本身走 GET /admin/auto-reply/log**（要翻页、要能改每页条数），
    // 塞在这个「一次说完所有状态」的接口里会让翻页牵动整页十五个查询。
    rows<{ n: number }>(env, warnings, 'SELECT COUNT(*) AS n FROM auto_reply_log'),

    rows<{ day: string; channel: string; n: number; tokens_in: number; tokens_out: number }>(
      env,
      warnings,
      `SELECT day, channel, n, tokens_in, tokens_out FROM ai_usage
        WHERE day >= ? ORDER BY day, channel`,
      from7,
    ),

    rows<{ n: number; oldest: number | null; failed: number }>(
      env,
      warnings,
      `SELECT COUNT(*) AS n, MIN(created_at) AS oldest,
              SUM(CASE WHEN tries >= 6 THEN 1 ELSE 0 END) AS failed
         FROM mail_outbox`,
    ),

    rows<{ pv: number; uv: number }>(
      env,
      warnings,
      'SELECT COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv FROM hits WHERE day = ?',
      day,
    ),

    rows<{ ts: number }>(env, warnings, 'SELECT MAX(ts) AS ts FROM hits'),

    rows<{ n: number }>(
      env,
      warnings,
      'SELECT COUNT(*) AS n FROM admin_sessions WHERE expires_at > ?',
      now,
    ),
  ]);

  const cs = toMap(commentStatus);
  const ac = toMap(appsByStatus);
  const fs = toMap(friendStates);
  const rt = toMap(replyToday);

  // 7 天流水折成「每天一行」，前端直接画柱状图
  const weekMap = new Map<string, { day: string; replied: number; skipped: number; blocked: number; failed: number }>();
  for (const r of replyWeek) {
    const d = r.day;
    if (!weekMap.has(d)) weekMap.set(d, { day: d, replied: 0, skipped: 0, blocked: 0, failed: 0 });
    const slot = weekMap.get(d)!;
    if (r.action in slot) slot[r.action as 'replied' | 'skipped' | 'blocked' | 'failed'] = Number(r.n ?? 0);
  }
  const replyDays = [...weekMap.values()].sort((a, b) => a.day.localeCompare(b.day));

  const mail = mailRows[0] ?? { n: 0, oldest: null, failed: 0 };
  const mailChannel = String(env.MAIL_ENDPOINT ?? '').trim()
    ? 'relay'
    : String(env.RESEND_KEY ?? '').trim()
      ? 'resend'
      : 'none';

  // 设置表读一次，值直接铺进返回体 —— 前端设置表单的初值就来自这里，
  // 不必再单开一个请求
  const arCfg = await autoReplyConfig(env);

  return json({
    ok: true,
    now,
    day,
    warnings,
    ai,
    autoReply: {
      ...arCfg,
      today: {
        replied: rt.replied ?? 0,
        skipped: rt.skipped ?? 0,
        blocked: rt.blocked ?? 0,
        failed: rt.failed ?? 0,
      },
      days: replyDays,
      /** 流水总条数。列表在 GET /admin/auto-reply/log，那一页可翻 */
      logTotal: autoLogCount[0]?.n ?? 0,
    },
    usage: usageWeek.map((u) => ({
      day: u.day,
      channel: u.channel,
      n: u.n,
      tokensIn: u.tokens_in,
      tokensOut: u.tokens_out,
    })),
    comments: {
      total: Object.values(cs).reduce((a, b) => a + b, 0),
      byStatus: cs,
      today: commentToday[0]?.n ?? 0,
      noReply: commentNoReply[0]?.n ?? 0,
    },
    friends: {
      applications: {
        pending: ac.pending ?? 0,
        approved: ac.approved ?? 0,
        rejected: ac.rejected ?? 0,
        total: Object.values(ac).reduce((a, b) => a + b, 0),
      },
      backlink: {
        total: backlinkRows[0]?.total ?? 0,
        broken: backlinkRows[0]?.broken ?? 0,
        errored: backlinkRows[0]?.errored ?? 0,
      },
      states: {
        normal: fs.normal ?? 0,
        unstable: fs.unstable ?? 0,
        violation: fs.violation ?? 0,
      },
    },
    mail: {
      channel: mailChannel,
      queued: mail.n ?? 0,
      stuck: mail.failed ?? 0,
      // ⚠️ mail_outbox.created_at 是**秒**（见 0012 迁移注释），前端统一按毫秒算相对时间
      oldest: mail.oldest === null ? null : Number(mail.oldest) * 1000,
    },
    traffic: {
      pv: hitToday[0]?.pv ?? 0,
      uv: hitToday[0]?.uv ?? 0,
      // ⚠️ hits.ts 也是**秒**（0001 迁移注释：unix 秒），别当成毫秒用
      lastHit: hitLast[0]?.ts ? Number(hitLast[0].ts) * 1000 : null,
    },
    runtime: {
      // 归档只读：CF 那份 D1 配了 READONLY，写请求全 410
      readonly: /^(1|true|yes)$/i.test(String(env.READONLY ?? '').trim()),
      github: Boolean(String(env.GITHUB_TOKEN ?? '').trim()),
      turnstile: Boolean(String(env.TURNSTILE_SECRET ?? '').trim()),
      salt: Boolean(String(env.HIT_IP_SALT ?? '').trim()),
      devSkipTurnstile: /^(1|true|yes)$/i.test(String(env.DEV_SKIP_TURNSTILE ?? '').trim()),
      sessions: sessionRows[0]?.n ?? 0,
      siteUrl: String(env.SITE_URL ?? '').trim() || 'https://www.qingwu.ink',
      persona: String(env.AI_PERSONA_NAME ?? '').trim() || '爱弥斯',
    },
  });
}

// ——————————————————————————————————————————————————————————
// POST /admin/status/ping —— 真打两条通道
//
// 会消耗配额（writer 约 30 token，judge 输出不计费），所以是手动按钮，不是自动刷新。
// ——————————————————————————————————————————————————————————
export async function postStatusPing(request: Request, env: Env, _admin: Admin): Promise<Response> {
  // 只允许后台同源调用；这里不再额外校验 body（没有参数）
  void request;
  const started = Date.now();
  const r = await pingChannels(env);
  return json({ ok: true, ms: Date.now() - started, ...r });
}

// ——————————————————————————————————————————————————————————
// GET /admin/auto-reply/log?page=1&pageSize=10
//
// 从 getStatus 里抽出来的一小块：站长要「限制一下一页显示多少条」，
// 而「一次说完所有状态」的接口不该为翻页重跑十五个查询。
// ——————————————————————————————————————————————————————————
export async function getAutoReplyLog(request: Request, env: Env, _admin: Admin): Promise<Response> {
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const rawSize = Number.parseInt(url.searchParams.get('pageSize') || '', 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(rawSize) ? rawSize : 10;

  let total = 0;
  let rows: {
    id: number;
    comment_id: number;
    action: string;
    verdict: string | null;
    note: string | null;
    model: string | null;
    tokens: number | null;
    ms: number | null;
    ts: number;
    author: string | null;
    body: string | null;
  }[] = [];

  try {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM auto_reply_log').first<{ n: number }>();
    total = Number(c?.n ?? 0);
    const pages0 = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.min(page, pages0);

    const r = await env.DB.prepare(
      `SELECT l.id, l.comment_id, l.action, l.verdict, l.note, l.model, l.tokens, l.ms, l.ts,
              c.author, c.body
         FROM auto_reply_log l
         LEFT JOIN comments c ON c.id = l.comment_id
        ORDER BY l.ts DESC LIMIT ? OFFSET ?`,
    )
      .bind(pageSize, (p - 1) * pageSize)
      .all<(typeof rows)[number]>();
    rows = r.results ?? [];

    return json({
      ok: true,
      total,
      page: p,
      pages: pages0,
      pageSize,
      items: rows.map((x) => ({
        id: x.id,
        commentId: x.comment_id,
        action: x.action,
        verdict: x.verdict,
        note: x.note,
        model: x.model,
        tokens: x.tokens,
        ms: x.ms,
        ts: x.ts,
        author: x.author ?? '',
        body: String(x.body ?? '').slice(0, 80),
      })),
    });
  } catch (e) {
    // 表还不存在（迁移没跑）：当成「没有记录」，而不是 500
    return json({
      ok: true,
      total: 0,
      page: 1,
      pages: 1,
      pageSize,
      items: [],
      warning: e instanceof Error ? e.message.slice(0, 100) : 'auto_reply_log 不可读',
    });
  }
}
