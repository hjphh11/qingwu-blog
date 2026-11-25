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

const REPORT_STATUS = new Set(['handled', 'dismissed']);
/** 封禁时长上限：30 天。再长就不该用「临时禁言」这个工具了 */
const BAN_MAX_MINUTES = 30 * 24 * 60;

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
