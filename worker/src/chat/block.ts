// 长亭 · 屏蔽某人
//
// POST   /chat/:id/block     屏蔽
// DELETE /chat/:id/block     取消屏蔽
//
// 语义只有一句：**我不再看见他的消息。**
//
// 三件特意不做的事，都是为了让「屏蔽」不变成一种武器：
//   · **单向**。不做「互相看不见」那套 —— 长亭是公共客厅，双向屏蔽会让一段对话
//     裂成两半，两个人都不知道为什么对方不接话；
//   · **不通知**。不给被屏蔽的人发信、不加标记，他那边一片安静。否则它就成了
//     「拉黑宣告」，而多数时候人只是想清静一会儿；
//   · **不删数据**。屏蔽只给我的读取加一个 `NOT EXISTS`（见 messages.ts 的
//     `blockClause`），消息一条没动，取消之后旧消息立刻回来。
//
// 屏蔽名单本身不回在 poll 里（那是 2.5 秒一趟的接口），只随 `/chat/who`（30 秒）
// 和这两个写接口回 —— 改完立刻把整份名单返回，前端不用再问一次。

import type { Env } from '../types';
import { json } from '../util';
import { avatarFromHash } from '../auth/avatar';
import { chatSessionUser } from '../auth/store';

/**
 * 上限。够用（正常人就屏蔽个位数），也挡住了「脚本把整间屋子都屏蔽一遍」
 * 这种把名单表当记事本写的行为。
 */
const MAX_BLOCKS = 200;

export interface BlockEntry {
  id: number;
  name: string;
  avatar: string;
  site: string;
  /** 屏蔽的时刻（毫秒），名单按它倒序 —— 最近屏蔽的排最前，方便「刚手滑了」 */
  at: number;
}

interface BlockRow {
  id: number;
  ts: number;
  name: string | null;
  avatar: string | null;
  hash: string | null;
  site: string | null;

}

/**
 * 我屏蔽了谁。
 *
 * `who` 与两个写接口共用这一份，保证「成员名单里少了谁」和「屏蔽名单里是谁」
 * 永远是同一个查询结果 —— 两处各写一遍 SQL，迟早会出现「名单里还有他，
 * 但消息已经看不见」的错位。
 */
export async function listBlocks(env: Env, meId: number): Promise<BlockEntry[]> {
  if (!meId || meId < 1) return [];
  const rows = await env.DB.prepare(
    `SELECT b.blocked_id AS id, b.ts AS ts,
            a.display_name AS name, a.avatar_url AS avatar,
            a.email_hash AS hash, a.site_url AS site
       FROM chat_blocks b LEFT JOIN accounts a ON a.id = b.blocked_id
      WHERE b.blocker_id = ?
      ORDER BY b.ts DESC
      LIMIT ?`,
  )
    .bind(meId, MAX_BLOCKS)
    .all<BlockRow>();
  const list = (rows.results ?? []) as BlockRow[];
  return list.map((r) => ({
    id: r.id,
    // LEFT JOIN：账号注销后仍留着一行占位，不然名单里会凭空少一行、
    // 而消息过滤还在按那个 id 生效（用户会找不到自己到底屏蔽了谁）
    name: r.name || `账号#${r.id}`,
    avatar: r.avatar || avatarFromHash(r.hash || ''),
    site: r.site || '',
    at: r.ts,
  }));
}

async function meOf(request: Request, env: Env) {
  try {
    return (await chatSessionUser(request, env))?.account ?? null;
  } catch {
    return null;
  }
}

/** 屏蔽 / 取消屏蔽。`on = false` 就是取消。 */
export async function setBlock(
  request: Request,
  env: Env,
  idParam: string,
  on: boolean,
): Promise<Response> {
  const me = await meOf(request, env);
  if (!me) return json({ ok: false, reason: 'login', message: '登录之后才能屏蔽' }, 401);

  const id = Number(idParam);
  if (!Number.isFinite(id) || id < 1) {
    return json({ ok: false, reason: 'bad_id' }, 400);
  }
  if (id === me.id) {
    return json({ ok: false, reason: 'self', message: '不能屏蔽自己' }, 400);
  }

  const now = Date.now();

  try {
    if (on) {
      const target = await env.DB.prepare('SELECT id FROM accounts WHERE id = ?')
        .bind(id)
        .first<{ id: number }>();
      if (!target) return json({ ok: false, reason: 'no_such_account' }, 404);

      const cnt = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM chat_blocks WHERE blocker_id = ?',
      )
        .bind(me.id)
        .first<{ n: number }>();
      if ((cnt?.n ?? 0) >= MAX_BLOCKS) {
        return json(
          { ok: false, reason: 'too_many', message: `最多屏蔽 ${MAX_BLOCKS} 个人` },
          400,
        );
      }

      // 幂等：重复屏蔽不报错（用户连点两下不该看到一个错误）
      await env.DB.prepare(
        `INSERT INTO chat_blocks (blocker_id, blocked_id, ts) VALUES (?, ?, ?)
           ON CONFLICT(blocker_id, blocked_id) DO NOTHING`,
      )
        .bind(me.id, id, now)
        .run();
    } else {
      await env.DB.prepare('DELETE FROM chat_blocks WHERE blocker_id = ? AND blocked_id = ?')
        .bind(me.id, id)
        .run();
    }

    return json({ ok: true, blocked: on, blocks: await listBlocks(env, me.id) });
  } catch (err) {
    console.error('[chat] 屏蔽失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage' }, 502);
  }
}
