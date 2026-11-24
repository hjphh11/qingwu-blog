// 长亭 · 侧栏数据（我的卡 + 在线的人）
//
// GET /chat/who
//
// 和 poll 分开是有意的：
//   · poll 2.5 秒一次，只该做「拿增量消息」这一件事，多查一次 JOIN 是浪费
//   · 侧栏内容（谁在线、我聊了多少句）变化很慢，30 秒刷一次就够
//
// 称号不用「Lv.N + EXP」那套：长亭是个歇脚的地方，不是副本。
// 用一句称呼 + 「再聊几句就是 XX 了」，既有进度感，又不至于像游戏面板。

import type { Env } from '../types';
import { json } from '../util';
import { avatarFromHash } from '../auth/avatar';
import { sessionUser, type AccountRow } from '../auth/store';
import { touchPresence } from './messages';

/** 在线判定窗口。与 messages.ts 的 ONLINE_WINDOW 保持一致 */
const ONLINE_WINDOW = 5 * 60 * 1000;

/**
 * 称号阶梯。**只在这里定义**，前端只负责渲染 ——
 * 改档位只改这一处，不会出现「前端一套、后端一套」。
 */
export const LADDER: Array<{ at: number; title: string }> = [
  { at: 0, title: '初来避雨' },
  { at: 5, title: '檐下常客' },
  { at: 20, title: '煮茶的人' },
  { at: 50, title: '长亭故人' },
  { at: 120, title: '守亭的人' },
];

interface Rank {
  title: string;
  /** 第几档（1 起）。不展示成「Lv.N」，只是给进度条用 */
  step: number;
  total: number;
  messages: number;
  nextTitle: string;
  /** 还差几句到下一档；已顶格为 0 */
  toNext: number;
  /** 当前档内的进度百分比（0~100） */
  progress: number;
}

function rankOf(messages: number): Rank {
  let idx = 0;
  for (let i = 0; i < LADDER.length; i++) {
    if (messages >= LADDER[i]!.at) idx = i;
  }
  const cur = LADDER[idx]!;
  const next = LADDER[idx + 1] ?? null;
  if (!next) {
    return {
      title: cur.title,
      step: idx + 1,
      total: LADDER.length,
      messages,
      nextTitle: '',
      toNext: 0,
      progress: 100,
    };
  }
  const span = next.at - cur.at;
  return {
    title: cur.title,
    step: idx + 1,
    total: LADDER.length,
    messages,
    nextTitle: next.title,
    toNext: Math.max(0, next.at - messages),
    progress: span > 0 ? Math.min(100, Math.round(((messages - cur.at) / span) * 100)) : 100,
  };
}

async function currentAccount(request: Request, env: Env): Promise<AccountRow | null> {
  try {
    return (await sessionUser(request, env))?.account ?? null;
  } catch {
    return null;
  }
}

/** presence JOIN accounts 出来的一行（显式声明：worker 的 tsc 认，前端 check 环境里 D1 泛型会丢） */
interface WhoRow {
  id: number;
  seen_at: number;
  name: string | null;
  avatar: string | null;
  hash: string | null;
  role: string;
  site: string | null;
  prefix: string | null;
}

export async function getWho(request: Request, env: Env): Promise<Response> {
  const me = await currentAccount(request, env);
  const now = Date.now();

  try {
    /**
     * 在线的人。
     *
     * JOIN accounts 拿当前头像和署名（和消息列表同一套口径：改名换头像要立刻生效）。
     * **只取 presence 表**，不拿「最近发过言的人」凑数 —— 发完就关页面的人不该还挂在名单上。
     */
    const rows = await env.DB.prepare(
      `SELECT p.account_id AS id, p.last_seen AS seen_at,
              a.display_name AS name, a.avatar_url AS avatar,
              a.email_hash AS hash, a.role AS role, a.site_url AS site,
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
      admin: (r.role ?? '') === 'admin',
      /// 秒级「几分钟前说过话」太重了，只给个布尔：在线名单里大家都是「在线」
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
          admin: (me.role ?? '') === 'admin',
          online: true,
        });
      }
    }

    let mine: (Rank & { id: number; name: string; avatar: string; site: string; admin: boolean }) | null =
      null;

    if (me) {
      /**
       * 累计发言：**把撤回的也算上**。
       *
       * 撤回是「说错了收回」，不是「没说」。按 visible 算会让一个常聊的人
       * 因为爱撤回而永远升不了称号 —— 这不是我们想奖励的行为。
       * spam / deleted 不算（那不是正常发言）。
       */
      const cnt = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM chat_messages
          WHERE account_id = ? AND status IN ('visible','pending','recalled')`,
      )
        .bind(me.id)
        .first<{ n: number }>();

      const rank = rankOf(cnt?.n ?? 0);
      mine = {
        ...rank,
        id: me.id,
        name: me.display_name || me.email.split('@')[0] || `茶客#${me.id}`,
        avatar: me.avatar_url || avatarFromHash(me.email_hash || ''),
        site: me.site_url || '',
        admin: (me.role ?? '') === 'admin',
      };
    }

    return json({ ok: true, me: mine, members });
  } catch (err) {
    console.error('[chat] who 失败:', err instanceof Error ? err.message : err);
    // 侧栏挂了不该影响聊天：回空列表，页面照常用
    return json({ ok: false, reason: 'storage', me: null, members: [] }, 502);
  }
}
