// 长亭 · 举报
//
//   POST /chat/:id/report   { reason }
//
// 为什么要有：这一条不是产品功能，是**备案站的义务**。现在的处置链条是
// 「AI 先发后审 → 命中就摘 → 站长巡查」，中间缺了最重要的一环：
// 看见的人没有出口。有人发了法律边缘的东西、AI 又没命中，访客只能关掉页面。
//
// 三条判断：
//   · **只记录，不自动隐藏**。按举报数自动下架是最好用的攻击手法：
//     注册三个号，就能让任何人的话消失。所以这里只落库，处置权留给站长。
//   · **一人一条只能报一次**（UNIQUE 约束），但同一条被**多个人**报要能数出来。
//   · 不告诉举报者「别人也报过」，也不回显原文 —— 举报者只需要知道「交到了」。
//
// 2026-11-25 加的一环：举报落库后**顺手交给模型看一眼**（`judgeReportById`），
// 结论落 `chat_reports.ai_*`。站长打开后台时结论已经在那儿，不用再点一次；
// 判了也只给建议，删和封仍然是人工按钮。

import type { Env } from '../types';
import { json } from '../util';
import { sessionUser } from '../auth/store';
import { judgeFreeText } from '../admin/ai';

/** 和审核口径同一套五类，外加一个 other */
const REASONS = new Set(['spam', 'abuse', 'porn', 'illegal', 'privacy', 'other']);

/** 每人每小时最多报几条：正常用户一两条，刷的人一小时能报几百条 */
const HOURLY_LIMIT = 20;

export async function reportMessage(
  request: Request,
  env: Env,
  // 只用到 waitUntil。写成结构类型而不是 ExecutionContext —— 后者在这份
  // tsconfig 里没有全局声明（全项目 40 多处都因此报 TS2304），不必再加一处。
  ctx: { waitUntil(p: Promise<unknown>): void },
  idParam: string,
): Promise<Response> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, reason: 'not_found' }, 404);

  const me = (await sessionUser(request, env))?.account ?? null;
  if (!me) {
    return json({ ok: false, reason: 'login_required', message: '登录之后才能举报' }, 401);
  }

  let payload: { reason?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, reason: 'bad_request', message: '请求格式不对' }, 400);
  }
  const reason = String(payload.reason ?? 'other');
  if (!REASONS.has(reason)) {
    return json({ ok: false, reason: 'bad_reason', message: '选一个理由' }, 400);
  }

  const msg = await env.DB.prepare(
    'SELECT account_id, status FROM chat_messages WHERE id = ?',
  )
    .bind(id)
    .first<{ account_id: number | null; status: string }>();

  if (!msg || (msg.status !== 'visible' && msg.status !== 'pending')) {
    return json({ ok: false, reason: 'not_found', message: '这条消息不在了' }, 404);
  }
  if (msg.account_id === me.id) {
    return json({ ok: false, reason: 'self', message: '自己的话就别举报了' }, 400);
  }

  const now = Date.now();
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM chat_reports WHERE account_id = ? AND ts > ?',
  )
    .bind(me.id, now - 3_600_000)
    .first<{ n: number | null }>();
  if ((recent?.n ?? 0) >= HOURLY_LIMIT) {
    return json(
      { ok: false, reason: 'rate_limited', message: '报得有点多，歇一会儿再报' },
      429,
    );
  }

  try {
    // UNIQUE(message_id, account_id)：重复点不会多出一行，也不算失败
    const res = await env.DB.prepare(
      'INSERT OR IGNORE INTO chat_reports (message_id, account_id, reason, status, ts) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, me.id, reason, 'open', now)
      .run();
    const already = (res.meta.changes ?? 0) === 0;
    const reportId = Number(res.meta.last_row_id ?? 0);

    /**
     * 落库之后才判，而且是 `waitUntil` —— **不能等**。
     *
     * 举报是一次交互动作，让人对着「提交中」等三秒是不对的；判错的代价也只是
     * 后台多一份结论，那本来就要人复核。结论落库，所以站长打开后台时它已经在。
     * 失败静默（没配 key / 超时 / 配额满）：卡片上仍会有「交给 DeepSeek 看」。
     */
    if (!already && reportId > 0) {
      ctx.waitUntil(
        judgeReportById(env, reportId).catch((err) => {
          console.warn('[chat] 举报复核失败:', err instanceof Error ? err.message : err);
        }),
      );
    }

    return json({
      ok: true,
      already,
      message: already ? '这条你已经报过了，站长还没看' : '交到站长那儿了，谢谢你',
    });
  } catch (err) {
    console.error('[chat] 举报落库失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '没报上去，稍后再试' }, 502);
  }
}

// ——————————————————————————————————————————————————————————
// 举报的模型复核：`judgeReportById`
//
// 两处调用同一个函数：
//   · 举报刚写进来 → `waitUntil`（自动，站长不用点）；
//   · 后台「重新判」→ 管理员接口（判挂了能重试，也能换阈值再判）。
//
// 口径复用评论审核那套（`judgeFreeText` → `judgeSystemOf` + `VERDICT_DESC`）：
// 同一段内容在评论里被拦、在长亭里被放，是最坏的结果。
// ——————————————————————————————————————————————————————————
export interface ReportVerdict {
  verdict: string;
  score: number;
  note: string;
  reasons: string[];
  model: string;
  at: number;
}

export type JudgeOutcome =
  | {
      ok: true;
      ai: ReportVerdict;
      /** 建议动作。**没有 ban**：封人只由站长决定 */
      advise: 'ignore' | 'delete' | 'review';
      wouldBlock: boolean;
      threshold: number;
      ms: number;
      tokens: number;
    }
  | { ok: false; status: number; reason: string; message?: string };

/**
 * 判一条举报，结论写回 `chat_reports.ai_*`。
 *
 * 为什么**结论必须落库**：判定要花钱。翻页、刷新、隔天再点进来都不该重判；
 * 而且结论是处置依据，事后要能对账（谁、什么时候、用哪个模型判的）。
 * 再点一次就是重判，覆盖旧值（`ai_at` 跟着变）。
 */
export async function judgeReportById(env: Env, reportId: number): Promise<JudgeOutcome> {
  const row = await env.DB.prepare(
    `SELECT r.id AS rid, m.id AS mid, m.body AS body, m.kind AS kind,
            COALESCE(NULLIF(a.display_name, ''), substr(a.email, 1, instr(a.email, '@') - 1)) AS author_name
       FROM chat_reports r
       LEFT JOIN chat_messages m ON m.id = r.message_id
       LEFT JOIN accounts a ON a.id = m.account_id
      WHERE r.id = ?`,
  )
    .bind(reportId)
    .first<{
      rid: number;
      mid: number | null;
      body: string | null;
      kind: string | null;
      author_name: string | null;
    }>();

  if (!row) return { ok: false, status: 404, reason: 'not_found' };
  if (!row.mid) {
    return { ok: false, status: 404, reason: 'message_gone', message: '这条消息已经不在了' };
  }

  /**
   * 媒体消息要先告诉模型「你看不到画面」。
   *
   * 不写明白，它会拿一句「[图片]」当正文去判，结论毫无意义；写明白之后
   * 它至少知道自己只能判那句说明，拿不准就给 ok / 低分，而不是硬猜。
   */
  const kindHint =
    row.kind === 'image'
      ? '[图片消息 · 画面内容无法读取，只能看下面这句说明]'
      : row.kind === 'video'
        ? '[视频消息 · 画面内容无法读取，只能看下面这句说明]'
        : row.kind === 'file'
          ? '[文件消息 · 文件内容无法读取，只能看下面这句说明]'
          : '';
  const body = [kindHint, (row.body ?? '').trim()].filter(Boolean).join('\n') || '（空消息）';

  const r = await judgeFreeText(env, {
    body,
    author: row.author_name || '长亭的访客',
    path: '/chat/（长亭 · 综合大厅）',
  });
  if (!r.ok) return { ok: false, status: r.status, reason: r.reason, message: r.message };

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE chat_reports
        SET ai_verdict = ?, ai_score = ?, ai_note = ?, ai_reasons = ?, ai_model = ?, ai_at = ?
      WHERE id = ?`,
  )
    .bind(
      r.verdict,
      r.score,
      r.note.slice(0, 200),
      JSON.stringify(r.reasons.slice(0, 3)),
      r.model.slice(0, 60),
      now,
      reportId,
    )
    .run();

  /**
   * 建议动作，只有三档：
   *   · ignore —— 判成正常，建议放行；
   *   · delete —— 命中类别且分数到阈值，也就是「自动流程本来就会拦」的那条；
   *   · review —— 像点什么但没到阈值：别替站长决定，让他自己看一眼。
   */
  const advise = r.verdict === 'ok' ? 'ignore' : r.wouldBlock ? 'delete' : 'review';

  return {
    ok: true,
    ai: {
      verdict: r.verdict,
      score: r.score,
      note: r.note,
      reasons: r.reasons,
      model: r.model,
      at: now,
    },
    advise,
    wouldBlock: r.wouldBlock,
    threshold: r.threshold,
    ms: r.ms,
    tokens: r.tokens,
  };
}
