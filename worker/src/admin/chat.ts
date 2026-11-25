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
import { json } from '../util';
import type { Admin } from './auth';
import { RULE_NOTES } from '../chat/screen';

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
}

/** 举报列表（open 在前）+ 当前生效的封禁 */
export async function getChatOverview(request: Request, env: Env, _admin: Admin): Promise<Response> {
  const now = Date.now();

  const reports = await env.DB.prepare(
    `SELECT r.id AS id, r.status AS status, r.reason AS reason, r.ts AS ts,
            m.id AS mid, m.body AS body, m.kind AS kind, m.status AS mstatus, m.ts AS mts,
            a.id AS author_id, a.email_hash AS author_hash,
            COALESCE(NULLIF(a.display_name, ''), substr(a.email, 1, instr(a.email, '@') - 1)) AS author_name,
            b.id AS reporter_id,
            COALESCE(NULLIF(b.display_name, ''), substr(b.email, 1, instr(b.email, '@') - 1)) AS reporter_name
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
    })),
    bans: banRows.map((b) => ({
      accountId: b.id,
      name: b.name || b.email?.split('@')[0] || `账号#${b.id}`,
      until: b.until,
      reason: b.reason ?? '',
      createdAt: b.created_at,
    })),
    openCount: rows.filter((r) => r.status === 'open').length,
    rules,
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
  request: Request,
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
  request: Request,
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
  request: Request,
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
