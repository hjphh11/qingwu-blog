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
import { chatSessionUser, type AccountRow } from '../auth/store';
import { touchPresence } from './messages';
import { listBlocks } from './block';
import { hostOfSite, loadPeerNames } from './peerName';
import { getRoster, hostOfUrl } from './roster';

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
async function listPeople(env: Env, meId: number): Promise<PeopleRow[]> {
  const rows = await env.DB.prepare(
    `SELECT a.id AS id,
            a.display_name AS name, a.avatar_url AS avatar,
            a.email_hash AS hash, a.role AS role, a.site_url AS site,
            a.bio AS bio,
            (SELECT MAX(last_seen) FROM chat_presence p WHERE p.account_id = a.id) AS seen,
            (SELECT COUNT(*) FROM chat_messages m
              WHERE m.account_id = a.id AND m.status = 'visible') AS posts,
            (SELECT MIN(ts) FROM chat_messages m WHERE m.account_id = a.id
              AND m.status = 'visible') AS first_post,
            (SELECT MAX(ts) FROM chat_messages m WHERE m.account_id = a.id
              AND m.status = 'visible') AS last_post
       FROM accounts a
      WHERE (EXISTS (SELECT 1 FROM chat_presence p2 WHERE p2.account_id = a.id)
         OR EXISTS (SELECT 1 FROM chat_messages m
                     WHERE m.account_id = a.id AND m.status <> 'deleted'))
        AND NOT EXISTS (
          SELECT 1 FROM chat_blocks b WHERE b.blocker_id = ? AND b.blocked_id = a.id
        )
      ORDER BY (a.role = 'admin') DESC, seen DESC, a.id DESC
      LIMIT 200`,
  )
    .bind(meId)
    .all<PeopleRow>();
  return (rows.results ?? []) as PeopleRow[];
}

async function currentAccount(request: Request, env: Env): Promise<AccountRow | null> {
  try {
    return (await chatSessionUser(request, env))?.account ?? null;
  } catch {
    return null;
  }
}

/** 把「来过的人」整理成前端要的形状：`online` 由 last_seen 落不落在窗口里决定 */
function peopleOf(rows: PeopleRow[], now: number) {
  return rows.map((r) => ({
    id: r.id,
    name: r.name || `茶客#${r.id}`,
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
              a.bio AS bio
         FROM chat_presence p JOIN accounts a ON a.id = p.account_id
        WHERE p.last_seen > ?
          AND NOT EXISTS (
            SELECT 1 FROM chat_blocks b WHERE b.blocker_id = ? AND b.blocked_id = p.account_id
          )
        ORDER BY (a.role = 'admin') DESC, p.last_seen DESC
        LIMIT 60`,
    )
      .bind(now - ONLINE_WINDOW, me?.id ?? -1)
      .all<WhoRow>();

    const raw = (rows.results ?? []) as WhoRow[];
    const members = raw.map((r) => ({
      id: r.id,
      name: r.name || `茶客#${r.id}`,
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
          name: me.display_name || `茶客#${me.id}`,
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
      people = peopleOf(await listPeople(env, me?.id ?? -1), now);
    } catch (e) {
      console.error('[chat] people 失败:', e instanceof Error ? e.message : e);
    }

    /**
     * 屏蔽名单。
     *
     * 一起回是为了省一次请求：右栏那张「已屏蔽」卡片要和成员名单同时刷新，
     * 分两个接口就会出现「成员里已经没他、屏蔽名单里还没他」的一瞬间。
     * 失败不影响 who 本身（名单挂了不该让聊天页没侧栏）。
     */
    let blocks: Awaited<ReturnType<typeof listBlocks>> = [];
    try {
      if (me) blocks = await listBlocks(env, me.id);
    } catch (e) {
      console.error('[chat] blocks 失败:', e instanceof Error ? e.message : e);
    }

    /**
     * 互联的大厅人数。侧栏把它和「此刻在长亭 N 人」并列显示 —— 后者是本站 presence，
     * 前者是 Matrix 房间的成员数（joined_members），两者口径不同，文案上不要混。
     */
    const sync = await env.DB.prepare(`SELECT remote_members FROM chat_sync WHERE id = 1`)
      .first<{ remote_members: number }>()
      .catch(() => null);

    /**
     * 互联站点：这间屋子实际收到过哪些站的消息。
     *
     * 不能靠「成员表里有没有别的站」—— 成员表只有我们自己的账号，`site_url` 永远是本域。
     * 真正能证明「那边有人说话」的只有消息本身：`remote_site` 是出站方带过来的站点地址，
     * 大厅原生用户的这条会被置空（`sync.ts` 里 hsHost 那段），所以空值归到大厅本体。
     * 同样兜一层：这张卡片挂了不该让 who 整体失败。
     */
    let peers: PeerRow[] = [];
    try {
      peers = await listPeers(env, now);
    } catch (e) {
      console.error('[chat] peers 失败:', e instanceof Error ? e.message : e);
    }

    return json({
      ok: true,
      guest: me?.role === 'chat_guest' ? {
        id: me.id, name: me.display_name, role: 'chat_guest', avatar: me.avatar_url,
        avatarCustom: false, emailHash: me.email_hash, site: '',
      } : null,
      members,
      people,
      blocks,
      peers,
      remote: { members: sync?.remote_members ?? 0 },
    });
  } catch (err) {
    console.error('[chat] who 失败:', err instanceof Error ? err.message : err);
    // 侧栏挂了不该影响聊天：回空列表，页面照常用
    return json({ ok: false, reason: 'storage', members: [] }, 502);
  }
}

/* ─────────────────────────── 互联站点 ─────────────────────────── */

/** 只看最近 30 天：更早的站已经不在场了，列出来是假话 */
const PEER_WINDOW = 30 * 24 * 3600 * 1000;

export type PeerRow = {
  host: string;
  name: string;
  n: number;
  home: boolean;
  /** 名册里对方自己填的图标（没有就走前端的老兜底：友链头像 → favicon） */
  icon?: string;
  /** 点「去看看」跳哪儿（名册的 siteUrl；没有就 https://host） */
  url?: string;
  /** 一句话简介（名册的 siteDescription） */
  desc?: string;
  /** 对方填的主题色，前端可用来染卡片 */
  color?: string;
};

/**
 * 「互联站点」：从**收到的远端消息**反推有哪些站在说话。
 *
 * 为什么不用成员表：`members` 只有我们自己的账号，`site_url` 永远是本域 ——
 * 这正是侧栏一直只显示「qingwu.ink · 1 个」的原因。
 *
 * - 空 `remote_site` 归到大厅本体（rainzt.cn）：`sync.ts` 会把大厅原生用户的 site 置空；
 * - 人数据 `COUNT(DISTINCT remote_sender)`，口径是「这个站有多少人在大厅说过话」，
 *   不是在线数 —— 前端那行也就只写「N 人」，不加「在线」二字；
 * - 本站钉在最前面（`home: true`），前端显示「本站」。
 */
/** `www.` 前缀对「是不是同一个站」没意义，比较前一律剥掉 */
function bare(host: string): string {
  return host.replace(/^www\./i, '').toLowerCase();
}

export async function listPeers(env: Env, now: number): Promise<PeerRow[]> {
  const rows = await env.DB.prepare(
    `SELECT remote_site AS site, COUNT(DISTINCT remote_sender) AS n
       FROM chat_messages
      WHERE origin = 'remote' AND status <> 'deleted' AND ts > ? AND remote_site IS NOT NULL
      GROUP BY remote_site`,
  )
    .bind(now - PEER_WINDOW)
    .all<{ site: string | null; n: number }>();

  const hub = hostOfSite(String(env.MATRIX_HS ?? ''));
  const self = hostOfSite(String(env.SITE_URL ?? '')) || 'qingwu.ink';

  /** 每个 host 有多少人在我们这儿说过话（只用于排序与「说没说过话」的判断） */
  const counts = new Map<string, number>();
  for (const r of rows.results ?? []) {
    const h = hostOfSite(String(r.site ?? '')) || hub;
    if (!h) continue;
    const k = bare(h);
    counts.set(k, (counts.get(k) ?? 0) + Number(r.n ?? 0));
  }

  /**
   * 名册优先：站名 / 图标 / 站点地址都是人家自己在 `members.json` 里填的，
   * 比「抓首页 title + 友链头像」准得多，而且不依赖「最近说过话」。
   */
  const roster = await getRoster(env, now);
  if (roster.length) {
    const keyOf = (m: (typeof roster)[number]) =>
      new Set([bare(m.host), bare(m.homeserver), bare(hostOfUrl(m.chatUrl))].filter(Boolean));

    const homeEntry = roster.find((m) => keyOf(m).has(bare(self)));
    const others = roster
      .filter((m) => m !== homeEntry)
      .map((m) => {
        let n = 0;
        for (const k of keyOf(m)) n += counts.get(k) ?? 0;
        return {
          host: m.host,
          name: m.name,
          n,
          home: false,
          icon: m.icon || undefined,
          url: m.url || undefined,
          desc: m.desc || undefined,
          color: m.color || undefined,
        };
      })
      // 说过话的排前面（聊得多的更靠前），没说过话的按站名排，顺序稳定不跳
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'zh-Hans-CN'));

    return [
      {
        host: homeEntry?.host || self,
        name: '',
        n: 0,
        home: true,
        icon: homeEntry?.icon || undefined,
        url: homeEntry?.url || undefined,
      },
      ...others,
    ];
  }

  /* ───────── 名册拿不到（离线 / 表还没建）→ 退回老逻辑 ───────── */

  // 站名是从对方首页 <title> 捞的缓存（cron 每分钟补一个）；没有就用域名
  const names = await loadPeerNames(env);
  const rest = [...counts.entries()]
    .filter(([h]) => bare(h) !== bare(self))
    .filter(([host]) => Boolean(names.get(host)))
    .map(([host, n]) => ({ host, name: names.get(host)!, n, home: false }))
    .sort((a, b) => b.n - a.n);

  return [{ host: self, name: '', n: 0, home: true }, ...rest];
}
