// 长亭 · 搜索聊天记录
//
// GET /chat/search?q=<关键词>&limit=30
//
// 只搜「还看得见」的消息（visible / recalled），被拦的和删掉的不该出现在结果里 ——
// 从搜索结果里点进去看到一条不存在的东西，比搜不到更让人困惑。
//
// ⚠️ LIKE 的 `%` 和 `_` 必须转义，否则用户输一个 `_` 就等于查所有消息。
//    SQLite 的 ESCAPE 子句要显式指定，默认没有转义字符。

import type { Env } from '../types';
import { json } from '../util';
import { avatarFromHash } from '../auth/avatar';
import { sessionUser } from '../auth/store';

/** 关键词最短长度 —— 一个汉字搜出来的是整个聊天室 */
const MIN_Q = 2;
const MAX_Q = 40;

export async function searchChat(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('q') || '').trim();
  const asked = Number.parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 50) : 30;

  if (raw.length < MIN_Q) {
    return json({ ok: true, messages: [], hint: `至少输 ${MIN_Q} 个字` });
  }
  const q = raw.slice(0, MAX_Q);

  // LIKE 转义：先转义转义符本身，再转义通配符
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  let meId: number | null = null;
  try {
    meId = (await sessionUser(request, env))?.account?.id ?? null;
  } catch {
    meId = null;
  }

  try {
    const rows = await env.DB.prepare(
      `SELECT m.id, m.body, m.ts, m.origin, m.account_id, m.status,
              m.remote_nick, m.remote_avatar,
              a.display_name AS acc_name, a.avatar_url AS acc_avatar,
              a.email_hash AS hash,
              substr(a.email, 1, instr(a.email, '@') - 1) AS prefix
         FROM chat_messages m LEFT JOIN accounts a ON a.id = m.account_id
        WHERE m.body LIKE ? ESCAPE '\\'
          AND (m.status IN ('visible','recalled')
               OR (m.status = 'pending' AND m.account_id = ?))
        ORDER BY m.id DESC
        LIMIT ?`,
    )
      .bind(like, meId ?? -1, limit)
      .all<{
        id: number;
        body: string;
        ts: number;
        origin: string;
        account_id: number | null;
        status: string;
        remote_nick: string | null;
        remote_avatar: string | null;
        acc_name: string | null;
        acc_avatar: string | null;
        hash: string | null;
        prefix: string | null;
      }>()
      .catch(() => ({ results: [] }));

    const messages = (rows.results ?? []).map((r) => {
      const remote = r.origin === 'remote';
      return {
        id: r.id,
        name: remote
          ? r.remote_nick || '远方的茶客'
          : r.acc_name || r.prefix || `茶客#${r.account_id ?? 0}`,
        avatar: remote
          ? r.remote_avatar || ''
          : r.acc_avatar || avatarFromHash(r.hash || ''),
        body: r.body,
        at: new Date(r.ts).toISOString(),
        recalled: r.status === 'recalled',
        mine: meId !== null && r.account_id === meId,
      };
    });

    return json({ ok: true, messages, q });
  } catch (err) {
    console.error('[chat] search 失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '搜不了，稍后再试', messages: [] }, 502);
  }
}
