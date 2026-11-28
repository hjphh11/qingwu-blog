// 长亭 · 后台：举报 / 删消息 / 封人
//
// 这一页是「举报」按钮的另一半。之前举报只落库、没有任何读取方 ——
// 前端说的是「交到站长那儿了」，实际上那份数据只有手写 SQL 才看得见。
//
// 三个动作的口径：
//   · 删消息 = **软删**（status='deleted'）。硬删会破坏「有人引用过它」的位置关系，
//     也会让 chat_reports 里那一行变成孤儿；
//   · 封人 = 写 chat_bans（发送时会查，见 messages.ts 的开头），
//     同一账号只留一条生效记录，免得旧记录把新时长盖住；
//   · 举报状态只有 open / handled / dismissed 三种，不做「已读未读」这种中间态。

import type { Env } from '../types';
import { bridgeState, setBridgePaused } from '../chat/pause';
import { json } from '../util';
import type { Admin } from './auth';
import { RULE_NOTES } from '../chat/screen';
import { judgeReportById } from '../chat/report';
import { queueRedact } from '../chat/bridge';
import { loadSettings } from './settings';

const REPORT_STATUS = new Set(['handled', 'dismissed']);
/** 封禁时长上限：30 天。再长就不该用「临时禁言」这个工具了 */
const BAN_MAX_MINUTES = 30 * 24 * 60;

interface RuleStatRow {
  id: string;
  hits: number;
  hurt: number;
  at: number;
}

interface AdminMsgRow {
  id: number;
  body: string;
  kind: string;
  status: string;
  ts: number;
  author_id: number;
  author_name: string | null;
  reports: number;
}

interface BanRow {
  id: number;
  until: number;
  reason: string | null;
  created_at: number;
  name: string | null;
  email: string | null;
}

interface ReportRow {
  id: number;
  status: string;
  reason: string;
  ts: number;
  mid: number | null;
  body: string | null;
  kind: string | null;
  mstatus: string | null;
  mts: number | null;
  author_id: number | null;
  author_name: string | null;
  author_hash: string | null;
  reporter_id: number | null;
  reporter_name: string | null;
  ai_verdict: string | null;
  ai_score: number | null;
  ai_note: string | null;
  ai_reasons: string | null;
  ai_model: string | null;
  ai_at: number | null;
}

/** 举报列表（open 在前）+ 当前生效的封禁 */
export async function getChatOverview(_request: Request, env: Env, _admin: Admin): Promise<Response> {
  const now = Date.now();

  const reports = await env.DB.prepare(
    `SELECT r.id AS id, r.status AS status, r.reason AS reason, r.ts AS ts,
            m.id AS mid, m.body AS body, m.kind AS kind, m.status AS mstatus, m.ts AS mts,
            a.id AS author_id, a.email_hash AS author_hash,
            COALESCE(NULLIF(a.display_name, ''), substr(a.email, 1, instr(a.email, '@') - 1)) AS author_name,
            b.id AS reporter_id,
            COALESCE(NULLIF(b.display_name, ''), substr(b.email, 1, instr(b.email, '@') - 1)) AS reporter_name,
            r.ai_verdict AS ai_verdict, r.ai_score AS ai_score, r.ai_note AS ai_note,
            r.ai_reasons AS ai_reasons, r.ai_model AS ai_model, r.ai_at AS ai_at
       FROM chat_reports r
       LEFT JOIN chat_messages m ON m.id = r.message_id
       LEFT JOIN accounts a ON a.id = m.account_id
       LEFT JOIN accounts b ON b.id = r.account_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.ts DESC
      LIMIT 100`,
  )
    .all<ReportRow>()
    .catch(() => ({ results: [] as ReportRow[] }));

  const bans = await env.DB.prepare(
    `SELECT cb.account_id AS id, cb.until AS until, cb.reason AS reason, cb.created_at AS created_at,
            a.display_name AS name, a.email AS email
       FROM chat_bans cb LEFT JOIN accounts a ON a.id = cb.account_id
      WHERE cb.until > ?
      ORDER BY cb.created_at DESC
      LIMIT 50`,
  )
    .bind(now)
    .all<{ id: number; until: number; reason: string | null; created_at: number; name: string | null; email: string | null }>()
    .catch(() => ({
      results: [] as BanRow[],
    }));
  const banRows = (bans.results ?? []) as BanRow[];

  /**
   * 审核规则的命中 / 误伤。
   *
   * `chat_rule_stats` 一直是「只写不读」——清单改哪条、哪条在误伤，全靠猜。
   * 这里把 `RULE_NOTES` 里**所有**规则都列出来（哪怕命中 0），
   * 因为「这条从没命中过」本身也是信息：可能已经过时了。
   */
  const statRows = await env.DB.prepare(
    'SELECT rule_id AS id, hits AS hits, hurt AS hurt, updated_at AS at FROM chat_rule_stats',
  )
    .all<RuleStatRow>()
    .catch(() => ({ results: [] as RuleStatRow[] }));
  const statList = (statRows.results ?? []) as RuleStatRow[];
  const statMap = new Map(statList.map((r) => [r.id, r]));
  const rules = Object.keys(RULE_NOTES)
    .sort()
    .map((id) => {
      const r = statMap.get(id);
      return {
        id,
        note: RULE_NOTES[id] ?? '',
        hits: r?.hits ?? 0,
        hurt: r?.hurt ?? 0,
        at: r?.at ?? 0,
      };
    });

  /**
   * 判定阈值随列表一起回。
   *
   * 举报卡上「建议放行 / 建议收走」要按同一个阈值算，否则前端得自己拍一个数，
   * 和 `judgeChatReport` 里那句 `wouldBlock` 就分成两套口径了。
   * `loadSettings` 本来就在内存里缓存，这一行几乎不花钱。
   */
  const threshold = (await loadSettings(env)).judge.threshold;

  const rows = (reports.results ?? []) as ReportRow[];
  return json({
    ok: true,
    now,
    reports: rows.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      ts: r.ts,
      message: r.mid
        ? {
            id: r.mid,
            body: r.body ?? '',
            kind: r.kind ?? 'text',
            status: r.mstatus ?? 'visible',
            ts: r.mts ?? 0,
            authorId: r.author_id ?? 0,
            authorName: r.author_name || `账号#${r.author_id ?? 0}`,
            authorHash: r.author_hash ?? '',
          }
        : null,
      reporter: { id: r.reporter_id ?? 0, name: r.reporter_name || `账号#${r.reporter_id ?? 0}` },
      // 判定结论（没判过就是 null，前端据此决定要不要显示那颗按钮的「重新判」字样）
      ai: r.ai_at
        ? {
            verdict: r.ai_verdict ?? 'ok',
            score: r.ai_score ?? 0,
            note: r.ai_note ?? '',
            reasons: parseReasons(r.ai_reasons),
            model: r.ai_model ?? '',
            at: r.ai_at,
          }
        : null,
    })),
    bans: banRows.map((b) => ({
      accountId: b.id,
      name: b.name || b.email?.split('@')[0] || `账号#${b.id}`,
      until: b.until,
      reason: b.reason ?? '',
      createdAt: b.created_at,
    })),
    openCount: rows.filter((r) => r.status === 'open').length,
    /** AI 判定的拦截阈值（0~100），举报卡按它算建议动作 */
    threshold,
    rules,
    /** 互联总开关：后台要能看出「现在是暂停还是通的」 */
    bridge: await bridgeState(env),
  });
}

/** 举报标成「已处理 / 忽略」 */
export async function setChatReportStatus(
  request: Request,
  env: Env,
  _admin: Admin,
  id: number,
): Promise<Response> {
  let status = '';
  try {
    const v = (await request.json()) as { status?: unknown };
    status = String(v?.status ?? '').trim();
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }
  if (!REPORT_STATUS.has(status)) return json({ ok: false, reason: 'bad_status' }, 400);

  const res = await env.DB.prepare('UPDATE chat_reports SET status = ? WHERE id = ?').bind(status, id).run();
  if (!res.meta?.changes) return json({ ok: false, reason: 'not_found' }, 404);
  return json({ ok: true, status });
}

/** 删一条消息（软删）。它名下的 open 举报一起标成 handled */
export async function deleteChatMessage(
  _request: Request,
  env: Env,
  _admin: Admin,
  id: number,
): Promise<Response> {
  const now = Date.now();
  const res = await env.DB.prepare(
    `UPDATE chat_messages SET status = 'deleted', updated_at = ? WHERE id = ? AND status <> 'deleted'`,
  )
    .bind(now, id)
    .run();
  if (!res.meta?.changes) return json({ ok: false, reason: 'not_found' }, 404);

  // 收走的消息不该继续挂在大厅 —— 撤回任务排队（没出站过的直接销账）
  await queueRedact(env, id);

  await env.DB.prepare(`UPDATE chat_reports SET status = 'handled' WHERE message_id = ? AND status = 'open'`)
    .bind(id)
    .run()
    .catch(() => undefined);

  return json({ ok: true });
}

/** 封一个人（分钟）。同一账号只留一条生效记录 */
export async function setChatBan(request: Request, env: Env, _admin: Admin): Promise<Response> {
  let body: { accountId?: unknown; minutes?: unknown; reason?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }
  const accountId = Number(body.accountId);
  const minutes = Math.round(Number(body.minutes));
  const reason = String(body.reason ?? '').slice(0, 60);
  if (!Number.isFinite(accountId) || accountId <= 0) return json({ ok: false, reason: 'bad_account' }, 400);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > BAN_MAX_MINUTES) {
    return json({ ok: false, reason: 'bad_minutes', message: '封禁时长要在 1 分钟到 30 天之间' }, 400);
  }

  const now = Date.now();
  const until = now + minutes * 60_000;
  await env.DB.prepare('DELETE FROM chat_bans WHERE account_id = ?').bind(accountId).run();
  await env.DB.prepare('INSERT INTO chat_bans (account_id, until, reason, created_at) VALUES (?, ?, ?, ?)')
    .bind(accountId, until, reason || null, now)
    .run();
  return json({ ok: true, until });
}

/** 解封 */
export async function clearChatBan(
  _request: Request,
  env: Env,
  _admin: Admin,
  accountId: number,
): Promise<Response> {
  const res = await env.DB.prepare('DELETE FROM chat_bans WHERE account_id = ?').bind(accountId).run();
  return json({ ok: true, removed: res.meta?.changes ?? 0 });
}

/**
 * 最近消息（巡查用）。
 *
 * 举报是「别人替你发现的」，这一栏是「你自己看一眼」。所以：
 *   · 已收走的（deleted）不列 —— 它们已经不是「现场」了；
 *   · 待审的（pending）要列，而且排在最前（那正是需要站长决定的那批）；
 *   · 每行带上被举报次数，一眼看出哪条已经有人不满。
 */
export async function getChatMessages(request: Request, env: Env, _admin: Admin): Promise<Response> {
  const url = new URL(request.url);
  const before = Number(url.searchParams.get('before') || '') || 0;
  const limit = 30;

  const rows = await env.DB.prepare(
    `SELECT m.id AS id, m.body AS body, m.kind AS kind, m.status AS status, m.ts AS ts,
            m.account_id AS author_id,
            COALESCE(NULLIF(a.display_name, ''), substr(a.email, 1, instr(a.email, '@') - 1)) AS author_name,
            (SELECT COUNT(*) FROM chat_reports r WHERE r.message_id = m.id) AS reports
       FROM chat_messages m LEFT JOIN accounts a ON a.id = m.account_id
      WHERE m.status <> 'deleted'${before > 0 ? ' AND m.id < ?' : ''}
      ORDER BY m.id DESC
      LIMIT ?`,
  )
    .bind(...(before > 0 ? [before, limit + 1] : [limit + 1]))
    .all<AdminMsgRow>()
    .catch(() => ({ results: [] as AdminMsgRow[] }));

  const list = (rows.results ?? []) as AdminMsgRow[];
  const hasMore = list.length > limit;
  const page = hasMore ? list.slice(0, limit) : list;
  return json({
    ok: true,
    hasMore,
    messages: page.map((r) => ({
      id: r.id,
      body: r.body ?? '',
      kind: r.kind ?? 'text',
      status: r.status ?? 'visible',
      ts: r.ts,
      authorId: r.author_id ?? 0,
      authorName: r.author_name || `账号#${r.author_id ?? 0}`,
      reports: r.reports ?? 0,
    })),
  });
}

/**
 * 给一条规则记一次「误伤」。
 *
 * 后台那一列的意义不是 KPI，而是**敢不敢改清单**：某条规则 hurt 涨得快，
 * 说明它判得宽，该收窄；一条规则长期 0 命中，说明它可能已经过时。
 * 单条消息的「这条没问题」将来可以接这里（直接在消息上点），现在先给规则记。
 */
export async function markRuleHurt(
  _request: Request,
  env: Env,
  _admin: Admin,
  id: string,
): Promise<Response> {
  const ruleId = String(id || '').slice(0, 12);
  if (!ruleId) return json({ ok: false, reason: 'bad_rule' }, 400);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO chat_rule_stats (rule_id, hits, hurt, updated_at) VALUES (?, 0, 1, ?)
       ON CONFLICT(rule_id) DO UPDATE SET hurt = hurt + 1, updated_at = excluded.updated_at`,
  )
    .bind(ruleId, now)
    .run();
  return json({ ok: true });
}

/** `ai_reasons` 存的是 JSON 数组字符串；坏了就当没写，不让一行脏数据把整页打挂 */
function parseReasons(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.slice(0, 3).map((x) => String(x).slice(0, 60)) : [];
  } catch {
    return [];
  }
}

/**
 * 后台那颗「交给 DeepSeek 看」/「重新判」。
 *
 * 真正的判定在 `chat/report.ts` 的 `judgeReportById` —— 举报写进来时已经
 * `waitUntil` 判过一次，这个接口是**重试口**：没配 key 时判不了、超时了、
 * 或者站长想换阈值再判一次，都点它。结论同样落库（覆盖旧的）。
 */
export async function judgeChatReport(
  _request: Request,
  env: Env,
  _admin: Admin,
  id: number,
): Promise<Response> {
  const r = await judgeReportById(env, id);
  if (!r.ok) {
    return json({ ok: false, reason: r.reason, message: r.message ?? '没判成，稍后再试' }, r.status);
  }
  return json(r);
}

/**
 * 把 AI 收起来的消息放回去。
 *
 * 只认 `removed`：站长自己收走的（`deleted`）要恢复得走另一套判断 ——
 * 那种情况往往是内容真有问题，不该和「模型误判」共用一颗按钮。
 *
 * 恢复本身也记一行流水（`restore`）：**误判率是本轮最该盯的数**。
 * 如果 `auto_remove` 里有一半紧接着出现 `restore`，那就该收紧阈值或者关掉自动收。
 */
export async function restoreChatMessage(
  _request: Request,
  env: Env,
  _admin: Admin,
  id: number,
): Promise<Response> {
  const now = Date.now();
  const res = await env.DB.prepare(
    `UPDATE chat_messages SET status = 'visible', updated_at = ? WHERE id = ? AND status = 'removed'`,
  )
    .bind(now, id)
    .run();
  if (!res.meta?.changes) return json({ ok: false, reason: 'not_removed' }, 404);

  await env.DB.prepare(
    `INSERT INTO chat_alerts (kind, report_id, message_id, ts) VALUES ('restore', NULL, ?, ?)`,
  )
    .bind(id, now)
    .run();
  return json({ ok: true });
}


/**
 * 暂停 / 恢复互联（临时断联）。
 *
 * 互联要求里的硬条款：维护者要能一把停掉双向同步，确认问题解决再恢复，
 * **暂停期间的消息不得在恢复后自动补发**。
 * 语义细节（出站清队、入站丢弃但推进游标）全在 `chat/pause.ts` 里。
 *
 * 调用：`POST /admin/chat/bridge`，body `{ paused: true|false, reason?: string }`。
 * 前端后台的「长亭」页用了它；也可以直接 curl（维护者会话 cookie / Bearer 均可）。
 */
export async function setChatBridge(
  request: Request,
  env: Env,
  admin: Admin,
): Promise<Response> {
  let body: { paused?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, message: '请求格式不对' }, 400);
  }
  if (typeof body.paused !== 'boolean') {
    return json({ ok: false, message: 'paused 必须是 true 或 false' }, 400);
  }
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : '';
  const state = await setBridgePaused(env, body.paused, admin.username, reason);
  return json({ ok: true, bridge: state });
}
