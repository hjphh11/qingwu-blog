// 清吾 · 后台「统计」—— 图表页的数据源
//
// 和 `/admin/status` 的分工：那边回答「现在什么状况」，这边回答「这半个月怎么变的」。
// 所以那边全是当下快照（今日 PV、队列积压），这边全是时间序列。
//
// 访问部分直接复用对外 `/stats` 的 buildStats()：**同一个站点不该有两个 PV 数**。
// 它给的是全量与近 90 天，这里只负责切区间、补空天、再并上它没有的那几路时间序列
// （评论、拦截、AI 用量、自动回复）。
//
// 补空天是必须的：图表按下标画，缺一天后面所有柱子就会左移一格。
// 查询返回的行只包含「有数据的天」，日期序列由这里生成。
//
// 一律走 try 兜底：某张表还没迁移（评论审核是 0020 才有的），
// 那一块画不出来，其余照常 —— 统计页 500 比少一张图糟得多。

import type { Env } from '../types';
import { dayKey, json } from '../util';
import { buildStats } from '../stats';
import type { Admin } from './auth';

const DAY_MS = 86_400_000;

/** 允许的区间。太长的区间在手机上一根柱子不到 2px，没意义。 */
const ALLOWED_DAYS = [7, 14, 30];

/** 北京时间当日 0 点（毫秒）。与 status.ts 同口径。 */
function dayStartMs(now = Date.now()): number {
  return Math.floor((now + 8 * 3_600_000) / DAY_MS) * DAY_MS - 8 * 3_600_000;
}

/** 从 from 到 today 的连续日期序列（升序） */
function daySeq(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(now - i * DAY_MS));
  return out;
}

/**
 * 读一组行。失败返回 null，并把「哪一块没读到」记进 warnings。
 *
 * ⚠️ 一定要记下来：这里是 try 吞错，没有 warnings 的话一块图悄悄全变 0，
 * 看起来像「这段时间真没数据」。写这一页时就踩过 —— `SELECT ... AS to` 是
 * SQLite 的语法错误（TO 是它的关键字），接口返回 200、AI 那张图全 0。
 */
async function rows<T>(
  env: Env,
  warnings: string[],
  label: string,
  sql: string,
  ...binds: unknown[]
): Promise<T[] | null> {
  try {
    const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
    const r = await stmt.all<T>();
    return r.results ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`${label}：${msg.slice(0, 100)}`);
    return null;
  }
}

// ——————————————————————————————————————————————————————————
// GET /admin/stats?days=14
// ——————————————————————————————————————————————————————————
export async function getStats(request: Request, env: Env, _admin: Admin): Promise<Response> {
  const now = Date.now();
  const today = dayKey(now);

  const wanted = Number(new URL(request.url).searchParams.get('days') ?? 14);
  const days = ALLOWED_DAYS.includes(wanted) ? wanted : 14;

  const seq = daySeq(days, now);
  const from = seq[0]!;
  const fromMs = dayStartMs(now) - (days - 1) * DAY_MS;
  /** 哪几块没读出来 —— 空数组才是「这段时间真没数据」 */
  const warnings: string[] = [];

  // —— 访问：复用对外 /stats 的口径 ——
  // 它自己有 90 天窗口，足够覆盖 7/14/30 任一区间。
  let base: Awaited<ReturnType<typeof buildStats>> | null = null;
  try {
    base = await buildStats(env);
  } catch {
    base = null;
  }

  const baseByDay = new Map<string, { pv: number; uv: number }>();
  for (const d of base?.days ?? []) baseByDay.set(d.d, { pv: d.pv, uv: d.uv });

  const traffic = seq.map((d) => {
    const v = baseByDay.get(d);
    return { day: d, pv: v?.pv ?? 0, uv: v?.uv ?? 0 };
  });

  // —— 区间榜单 + 时段（全部只看 hits：明细才拆得出维度）——
  const [pageRows, refRows, countryRows, deviceRows, hourRows] = await Promise.all([
    rows<{ k: string; pv: number }>(
      env,
      warnings,
      '页面榜',
      'SELECT path AS k, COUNT(*) AS pv FROM hits WHERE day >= ? GROUP BY path ORDER BY pv DESC LIMIT 8',
      from,
    ),
    rows<{ k: string; pv: number }>(
      env,
      warnings,
      '来源榜',
      `SELECT referrer AS k, COUNT(*) AS pv FROM hits
        WHERE day >= ? AND referrer IS NOT NULL AND referrer != ''
        GROUP BY referrer ORDER BY pv DESC LIMIT 6`,
      from,
    ),
    rows<{ k: string; pv: number }>(
      env,
      warnings,
      '地区榜',
      `SELECT country AS k, COUNT(*) AS pv FROM hits
        WHERE day >= ? AND country IS NOT NULL
        GROUP BY country ORDER BY pv DESC LIMIT 8`,
      from,
    ),
    rows<{ k: string; pv: number }>(
      env,
      warnings,
      '设备榜',
      `SELECT device AS k, COUNT(*) AS pv FROM hits
        WHERE day >= ? AND device IS NOT NULL
        GROUP BY device ORDER BY pv DESC`,
      from,
    ),
    // 时段分布：ts 是 unix 秒，+28800 之后取小时就是北京时间。
    // 不用 ts 在 JS 里算 —— 几千行搬进内存只为数 24 个桶，不值。
    rows<{ h: number; pv: number }>(
      env,
      warnings,
      '时段分布',
      `SELECT CAST(strftime('%H', ts + 28800, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS pv
         FROM hits WHERE day >= ? GROUP BY h ORDER BY h`,
      from,
    ),
  ]);

  // 四个榜单形状一致：{ name, pv }。前端不必知道哪个是路径哪个是国家码。
  const rank = (r: { k: string | null; pv: number }[] | null) =>
    (r ?? [])
      .filter((x) => x.k !== null && String(x.k).trim() !== '')
      .map((x) => ({ name: String(x.k), pv: Number(x.pv) || 0 }));

  const hours = Array.from({ length: 24 }, (_, h) => ({
    h,
    pv: Number((hourRows ?? []).find((x) => Number(x.h) === h)?.pv ?? 0),
  }));

  // —— 评论：每日新增 + 每日拦截 ——
  // comments 没有 day 列（写它的时候还没确定要不要按天统计），ts 在 JS 里分桶。
  // 留言量级很小，一次取回整段比在 SQL 里做时区转换可靠。
  const commentRows = await rows<{ ts: number; status: string }>(
    env,
    warnings,
    '每日评论',
    'SELECT ts, status FROM comments WHERE ts >= ?',
    fromMs,
  );

  const commentBuckets = new Map<string, { total: number; spam: number }>();
  for (const r of commentRows ?? []) {
    const d = dayKey(Number(r.ts));
    const b = commentBuckets.get(d) ?? { total: 0, spam: 0 };
    b.total += 1;
    if (r.status === 'spam') b.spam += 1;
    commentBuckets.set(d, b);
  }
  const comments = seq.map((d) => ({
    day: d,
    total: commentBuckets.get(d)?.total ?? 0,
    spam: commentBuckets.get(d)?.spam ?? 0,
  }));

  // 拦截明细按类别 —— 这张表是 0020 才有的，读不到就当空
  const verdictRows = await rows<{ verdict: string; n: number }>(
    env,
    warnings,
    '拦截类别',
    'SELECT verdict AS verdict, COUNT(*) AS n FROM moderation_log WHERE day >= ? GROUP BY verdict ORDER BY n DESC',
    from,
  );
  const blockedDaily = await rows<{ day: string; n: number }>(
    env,
    warnings,
    '每日拦截',
    'SELECT day AS day, COUNT(*) AS n FROM moderation_log WHERE day >= ? GROUP BY day',
    from,
  );
  const blockedMap = new Map((blockedDaily ?? []).map((r) => [r.day, Number(r.n) || 0]));
  const blockedSeq = seq.map((d) => ({ day: d, n: blockedMap.get(d) ?? 0 }));

  // —— AI 用量：两个通道各自计配额 ——
  // ⚠️ 别名别叫 `to` —— SQLite 在 `... AS to` 上直接报 syntax error（TO 是它的关键字）。
  const aiRows = await rows<{ day: string; channel: string; n: number; ti: number; tkout: number }>(
    env,
    warnings,
    'AI 用量',
    `SELECT day AS day, channel AS channel, n AS n, tokens_in AS ti, tokens_out AS tkout
       FROM ai_usage WHERE day >= ? ORDER BY day`,
    from,
  );
  const ai = seq.flatMap((d) =>
    ['writer', 'judge'].map((ch) => {
      const hit = (aiRows ?? []).find((x) => x.day === d && x.channel === ch);
      return {
        day: d,
        channel: ch,
        n: Number(hit?.n ?? 0),
        tokensIn: Number(hit?.ti ?? 0),
        tokensOut: Number(hit?.tkout ?? 0),
      };
    }),
  );

  // —— 自动回复：每天回过 / 挡下 / 判否 / 失败 ——
  const replyRows = await rows<{ day: string; action: string; n: number }>(
    env,
    warnings,
    '自动回复',
    'SELECT day AS day, action AS action, COUNT(*) AS n FROM auto_reply_log WHERE day >= ? GROUP BY day, action',
    from,
  );
  const replies = seq.map((d) => {
    const pick = (a: string) => Number((replyRows ?? []).find((x) => x.day === d && x.action === a)?.n ?? 0);
    return {
      day: d,
      replied: pick('replied'),
      skipped: pick('skipped'),
      blocked: pick('blocked'),
      failed: pick('failed'),
    };
  });

  // —— 汇总 ——
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const pv = sum(traffic.map((t) => t.pv));
  const uv = sum(traffic.map((t) => t.uv));
  const commentTotal = sum(comments.map((c) => c.total));
  const blockedTotal = sum(blockedSeq.map((b) => b.n));
  const aiCalls = sum(ai.map((a) => a.n));
  const tokens = sum(ai.map((a) => a.tokensIn + a.tokensOut));

  // 环比：取紧邻的前一个等长区间。只用得上 PV/UV/评论三个数。
  const prevSeq = daySeq(days, now - days * DAY_MS);
  const prevPv = sum(prevSeq.map((d) => baseByDay.get(d)?.pv ?? 0));
  const prevUv = sum(prevSeq.map((d) => baseByDay.get(d)?.uv ?? 0));

  return json({
    ok: true,
    now,
    day: today,
    days,
    from,
    to: today,
    /** 哪几块没读出来。非空时前端必须明说 —— 静默全 0 会被当成「真没数据」 */
    warnings,
    /** 访问部分是不是从对外 /stats 拿到的。false 时 PV 图会全 0，前端据此提示 */
    trafficReady: base !== null,
    totals: { pv, uv, comments: commentTotal, blocked: blockedTotal, replies: sum(replies.map((r) => r.replied)), aiCalls, tokens },
    /** 环比只给访问 —— 评论量太小，差 3 条算出来的百分比没有意义 */
    prev: { pv: prevPv, uv: prevUv },
    traffic,
    pages: rank(pageRows),
    referrers: rank(refRows),
    countries: rank(countryRows),
    devices: rank(deviceRows),
    hours,
    comments,
    blocked: blockedSeq,
    verdicts: (verdictRows ?? []).map((r) => ({ verdict: r.verdict, n: Number(r.n) || 0 })),
    ai,
    replies,
  });
}
