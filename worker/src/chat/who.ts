// 长亭 · 在线的人
//
// GET /chat/who
//
// 和 poll 分开是有意的：
//   · poll 2.5 秒一次，只该做「拿增量消息」这一件事，多查一次 JOIN 是浪费
//   · 在线名单变化很慢，30 秒刷一次就够
//
// ⚠️ 这里**不再返回「称号 / 经验 / 累计发言」**（2026-11-24 站长否掉了整套）。
//    理由记一下，免得以后有人又想加回来：那套是副本面板的语言，
//    长亭是歇脚的地方 —— 进来坐坐不需要「你还差 11 句升到下一级」。
//    侧栏那个「我是谁」只剩头像和昵称，直接从会话里拿，不必再让这个接口算。

import type { Env } from '../types';
import { json } from '../util';
import { avatarFromHash } from '../auth/avatar';
import { sessionUser, type AccountRow } from '../auth/store';
import { touchPresence } from './messages';

/** 在线判定窗口。与 messages.ts 的 ONLINE_WINDOW 保持一致 */
const ONLINE_WINDOW = 5 * 60 * 1000;

/** presence JOIN accounts 出来的一行（显式声明：前端 check 环境里 D1 泛型会丢） */
interface WhoRow {
  id: number;
  name: string | null;
  avatar: string | null;
  hash: string | null;
  role: string;
  site: string | null;
  /** 自己写的一句简介（人卡用） */
  bio: string | null;
  prefix: string | null;
}

/** 「来过的人」那一条：多一个 last_seen */
interface PeopleRow extends WhoRow {
  seen: number | null;
  /** 在这间屋子里说过多少句（只数 visible，撤回到的不算） */
  posts: number | null;
  /** 第一句 / 最后一句的时间戳；没说过话为 null */
  first_post: number | null;
  last_post: number | null;
}

/**
 * 所有来过这间屋子的人：进过门（presence 留下过一行）或者说过话（消息表里有他）。
 *
 * 为什么要两路都查：presence 只在 poll 里写，某些老账号可能早就不在表里了，
 * 但消息还在 —— 只查 presence 会把这些「说过话的人」漏掉。
 * 不看 chat_reads：那是阅读游标，可能是脚本写的，不代表人来过。
 *
 * 上限 200：这间屋子不大，真到几百人时这个名单也该分页了。
 */
async function listPeople(env: Env, now: number): Promise<PeopleRow[]> {
  const rows = await env.DB.prepare(
    `SELECT a.id AS id,
            a.display_name AS name, a.avatar_url AS avatar,
            a.email_hash AS hash, a.role AS role, a.site_url AS site,
            a.bio AS bio,
            substr(a.email, 1, instr(a.email, '@') - 1) AS prefix,
            (SELECT MAX(last_seen) FROM chat_presence p WHERE p.account_id = a.id) AS seen,
            (SELECT COUNT(*) FROM chat_messages m
              WHERE m.account_id = a.id AND m.status = 'visible') AS posts,
            (SELECT MIN(ts) FROM chat_messages m WHERE m.account_id = a.id
              AND m.status = 'visible') AS first_post,
            (SELECT MAX(ts) FROM chat_messages m WHERE m.account_id = a.id
              AND m.status = 'visible') AS last_post
       FROM accounts a
      WHERE EXISTS (SELECT 1 FROM chat_presence p2 WHERE p2.account_id = a.id)
         OR EXISTS (SELECT 1 FROM chat_messages m
                     WHERE m.account_id = a.id AND m.status <> 'deleted')
      ORDER BY (a.role = 'admin') DESC, seen DESC, a.id DESC
      LIMIT 200`,
  ).all<PeopleRow>();
  return (rows.results ?? []) as PeopleRow[];
}

async function currentAccount(request: Request, env: Env): Promise<AccountRow | null> {
  try {
    return (await sessionUser(request, env))?.account ?? null;
  } catch {
    return null;
  }
}

/** 把「来过的人」整理成前端要的形状：`online` 由 last_seen 落不落在窗口里决定 */
function peopleOf(rows: PeopleRow[], now: number) {
  return rows.map((r) => ({
    id: r.id,
    name: r.name || r.prefix || `茶客#${r.id}`,
    avatar: r.avatar || avatarFromHash(r.hash || ''),
    site: r.site || '',
    bio: r.bio || '',
    admin: (r.role ?? '') === 'admin',
    online: (r.seen ?? 0) > now - ONLINE_WINDOW,
    seen: r.seen ?? 0,
    posts: r.posts ?? 0,
    firstPost: r.first_post ?? 0,
    lastPost: r.last_post ?? 0,
  }));
}

export async function getWho(request: Request, env: Env): Promise<Response> {
  const me = await currentAccount(request, env);
  const now = Date.now();

  try {
    /**
     * JOIN accounts 拿当前头像和署名（和消息列表同一套口径：改名换头像要立刻生效）。
     * **只取 presence 表**，不拿「最近发过言的人」凑数 —— 发完就关页面的人不该还挂在名单上。
     */
    const rows = await env.DB.prepare(
      `SELECT p.account_id AS id,
              a.display_name AS name, a.avatar_url AS avatar,
              a.email_hash AS hash, a.role AS role, a.site_url AS site,
              a.bio AS bio,
              substr(a.email, 1, instr(a.email, '@') - 1) AS prefix
         FROM chat_presence p JOIN accounts a ON a.id = p.account_id
        WHERE p.last_seen > ?
        ORDER BY (a.role = 'admin') DESC, p.last_seen DESC
        LIMIT 60`,
    )
      .bind(now - ONLINE_WINDOW)
      .all<WhoRow>();

    const raw = (rows.results ?? []) as WhoRow[];
    const members = raw.map((r) => ({
      id: r.id,
      name: r.name || r.prefix || `茶客#${r.id}`,
      avatar: r.avatar || avatarFromHash(r.hash || ''),
      site: r.site || '',
      bio: r.bio || '',
      admin: (r.role ?? '') === 'admin',
      online: true,
    }));

    /**
     * 先把自己记成在场，再确保自己在名单里。
     *
     * 为什么需要：首屏 `init()` 里 history / me / who 是**并发**的，而 presence
     * 是在第一次 poll 里才写的 —— who 跑在前面时表里还没有自己，名单就会
     * 「2 人在长亭，但只列出 1 个」。正在请求这个接口的人当然算在场。
     */
    if (me) {
      await touchPresence(env, me.id, now);
      if (!members.some((m) => m.id === me.id)) {
        members.unshift({
          id: me.id,
          name: me.display_name || me.email.split('@')[0] || `茶客#${me.id}`,
          avatar: me.avatar_url || avatarFromHash(me.email_hash || ''),
          site: me.site_url || '',
          bio: me.bio || '',
          admin: (me.role ?? '') === 'admin',
          online: true,
        });
      }
    }

    /**
     * 名单（所有来过的人）单独兜一层：这张卡片挂了不该让在线名单一起 502。
     */
    let people: ReturnType<typeof peopleOf> = [];
    try {
      people = peopleOf(await listPeople(env, now), now);
    } catch (e) {
      console.error('[chat] people 失败:', e instanceof Error ? e.message : e);
    }

    return json({ ok: true, members, people });
  } catch (err) {
    console.error('[chat] who 失败:', err instanceof Error ? err.message : err);
    // 侧栏挂了不该影响聊天：回空列表，页面照常用
    return json({ ok: false, reason: 'storage', members: [] }, 502);
  }
}
