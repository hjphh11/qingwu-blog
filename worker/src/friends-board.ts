// 清吾 · 友链评论区（留言 / 回复 / 点赞 / 邮件通知）
//
// 路由：
//   GET  /friends-board                  公开列表（含回复与点赞数，**不含邮箱**）
//   POST /friends-board                  留言（可带站点地址、头像、邮箱）
//   POST /friends-board/:id/reply        回复某条（自动 @ 对方，并邮件通知他）
//   POST /friends-board/:id/like         点赞（同一访客只算一次）
//
// 落库复用 0001 的 `comments` 表（post_slug='friends'，楼中楼用 parent_id），
// 0007 给它补了 email / author_url / avatar 三列，点赞另开 `friend_likes`。
//
// ⚠️ 隐私边界：邮箱只用来发通知，**任何响应里都不会出现它**。
//    下面所有 SELECT 都显式列字段，没有 `SELECT *`。
//
// ⚠️ 发信一律 `ctx.waitUntil`：邮件失败不能把访客的留言卡在 502 上。

import type { Env } from './types';
import { json, originAllowed, parseOrigins, plainOf, secretEqual } from './util';
import { boardMailText, flushOutbox, sendMail } from './mail';
import { autoReplyTo, moderateComment } from './admin/ai';
import type { ModerationResult } from './admin/ai';
import { recordModeration } from './admin/moderation';
// 统一身份：谁在说话由 auth 模块决定；**能不能说话**由这里决定（REQUIRE_LOGIN）
import { isOn } from './auth/common';
import { avatarFromEmail, avatarFromHash } from './auth/avatar';
import { sessionUser, type AccountRow } from './auth/store';
import { loginRequiredMessage } from './auth/index';
import { visitorKey } from './visitor';

/** 友链评论区在 comments 表里的分区名 */
const SLUG = 'friends';

const LIMITS = { author: 30, url: 300, avatar: 300, body: 300, email: 254 } as const;

/** 同一访客 10 分钟最多 6 条 —— 和 /apply 的 5 条一个量级 */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6;

const URL_RE = /^https?:\/\/[^\s/]+\.[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface CommentRow {
  id: number;
  parent_id: number | null;
  author: string;
  author_url: string | null;
  avatar: string | null;
  body: string;
  status: string;
  ts: number;
  /** 邮箱的 MD5 —— 列表靠它取 Gravatar/QQ 头像，**不是邮箱本身** */
  email_hash: string | null;
  /** 这条回复有没有 @ 主楼作者（1 = 有，会发邮件）；主楼恒为 1 */
  notify: number | null;
  /** 归属账号。老留言与匿名留言为 null */
  account_id: number | null;
  /** 回的是哪一条回复（纯 id，不嵌套）。空 = 回主楼 */
  reply_to_id: number | null;
  /**
   * 账号**当前**的头像 / 署名（LEFT JOIN accounts 带出来的）。
   *
   * 有这两个字段，改了头像或署名之后历史留言会跟着变 —— 那才叫「一份档案」。
   * 匿名留言这两列是 null，回落 `avatar` / `author` 那份历史快照。
   */
  acc_avatar?: string | null;
  acc_name?: string | null;
  /** 账号身份（`admin` = 站长）。前台据此挂站长标 */
  acc_role?: string | null;
}

// ——————————————————————————————————————————————————————————
// 小工具
// ——————————————————————————————————————————————————————————
function withCors(request: Request, env: Env, extra: Record<string, string> = {}) {
  const origin = request.headers.get('origin') || '';
  const headers: Record<string, string> = { 'cache-control': 'no-store', ...extra };
  if (origin && originAllowed(origin, parseOrigins(env.ALLOWED_ORIGINS))) {
    headers['access-control-allow-origin'] = origin;
    // 会话 cookie：同源 /api 用不到这一行，但「浏览器直连 Worker」时要它才肯带凭证
    headers['access-control-allow-credentials'] = 'true';
  }
  return headers;
}

/**
 * 当前账号。
 *
 * 返回三种值，**含义不能混**：
 *   · `AccountRow` —— 已登录
 *   · `null`       —— 没登录（正常情况）
 *   · `undefined`  —— 身份表还没迁移 / 查询挂了
 *
 * `undefined` 时留言照常放行（退回老行为）。理由：迁移没跑完就把留言板锁死，
 * 代价远大于放进来几条匿名留言 —— 而且此时 REQUIRE_LOGIN 也拿不到任何账号，
 * 一刀切会让所有人（包括站长）都发不出去。
 */
async function currentAccount(request: Request, env: Env): Promise<AccountRow | null | undefined> {
  try {
    const s = await sessionUser(request, env);
    return s?.account ?? null;
  } catch (err) {
    console.warn('[friends-board] 会话读取失败，按未迁移处理：', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/** 登录后点过的赞按账号去重；未登录仍按 IP|UA 哈希 */
function likeKeyOf(key: string, account: AccountRow | null | undefined): string {
  return account ? `a${account.id}` : key;
}

/**
 * 限流：10 分钟内同一个「人」最多 6 条 —— **主楼和回复都算**。
 *
 * 登录后按账号计：NAT / 校园网下几十个人共用一个出口 IP，
 * 按 IP 限会让素不相识的人互相顶额度。未登录仍按 IP|UA 哈希。
 * （`account` 为 undefined = 身份表没迁移，按未登录处理。）
 *
 * ⚠️ 回复以前**根本没有限流** —— 只要有一栋楼存在，就能无限往里回。
 * 现在两处共用这一个判断。
 */
async function overRate(
  env: Env,
  account: AccountRow | null | undefined,
  anonKey: string,
  now: number,
): Promise<boolean> {
  const row = account
    ? await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM comments WHERE post_slug = ? AND account_id = ? AND ts > ?`,
      )
        .bind(SLUG, account.id, now - RATE_WINDOW_MS)
        .first<{ n: number }>()
    : await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM comments WHERE post_slug = ? AND ip_hash = ? AND ts > ?`,
      )
        .bind(SLUG, anonKey, now - RATE_WINDOW_MS)
        .first<{ n: number }>();

  return (row?.n ?? 0) >= RATE_MAX;
}

/**
 * 32 位 hex 的删除凭证。
 *
 * 为什么要它：评论区没有登录，光有评论 id 谁都能删别人的。
 * 这个 token 只在创建时回给提交者一次（列表接口不返回），前端存 localStorage，
 * 删除时带上比对。
 */
function newDeleteToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function normalizeUrl(raw: string): string {
  const t = (raw || '').trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

interface Payload {
  name?: unknown;
  email?: unknown;
  url?: unknown;
  avatar?: unknown;
  intro?: unknown;
  /** 前端算好的邮箱 MD5（只决定头像长什么样，校验格式后存） */
  avatarHash?: unknown;
  /** 回复专用：false = 访客取消了 @，不显示 @某某、也不发通知邮件 */
  notify?: unknown;
  /** 回复专用：在回哪一条回复（纯数字 comment id）。不带 = 回主楼 */
  replyTo?: unknown;
}

interface Clean {
  name: string;
  email: string;
  url: string;
  avatar: string;
  intro: string;
}

function validate(
  body: Payload,
  hasAccount = false,
): { ok: true; v: Clean } | { ok: false; fields: Record<string, string> } {
  const v: Clean = {
    name: String(body.name ?? '').trim(),
    email: String(body.email ?? '').trim(),
    url: body.url ? normalizeUrl(String(body.url)) : '',
    avatar: body.avatar ? normalizeUrl(String(body.avatar)) : '',
    intro: String(body.intro ?? '').trim(),
  };
  const e: Record<string, string> = {};
  // 登录后署名与站点来自档案，可以都不填 —— 档案里也没有才报错
  if (!v.name && !hasAccount) e.name = '请填一下站点名称';
  else if (v.name.length > LIMITS.author) e.name = `名称最多 ${LIMITS.author} 个字`;
  if (!v.intro) e.intro = '内容不能为空';
  else if (v.intro.length > LIMITS.body) e.intro = `内容最多 ${LIMITS.body} 个字`;
  if (v.url && (!URL_RE.test(v.url) || v.url.length > LIMITS.url)) e.url = '网址看起来不太对';
  if (v.avatar && (!URL_RE.test(v.avatar) || v.avatar.length > LIMITS.avatar)) e.avatar = '头像地址看起来不对';
  // 登录后邮箱来自账号，不再接受前端传的邮箱（避免手填别人的邮箱接通知）
  if (!hasAccount && v.email && (!EMAIL_RE.test(v.email) || v.email.length > LIMITS.email)) {
    e.email = '邮箱格式看起来不对';
  }
  return Object.keys(e).length ? { ok: false, fields: e } : { ok: true, v };
}

/**
 * 组装成前端要的公开形状（字段名与 `src/lib/friendsBoard.ts` 的 FriendEntry 对齐）
 */
function toEntry(
  row: CommentRow,
  replies: CommentRow[],
  likes: number,
  opts: { mine?: boolean; liked?: boolean } = {},
) {
  /**
   * 「这条回复是在回谁」。
   *
   * 结构上所有回复都挂在主楼（一层），二级回复只多了个 `reply_to_id`。
   * 所以 @ 的名字要现查：先按 id 在同楼的回复里找，找不到（被删了）就退回主楼作者 ——
   * 宁可 @ 得笼统一点，也别留一个空的「@」。
   */
  const nameOf = new Map(replies.map((r) => [r.id, r.acc_name || r.author]));
  const mainName = row.acc_name || row.author;
  const toOf = (r: CommentRow) => {
    if (r.notify === 0) return '';
    if (!r.reply_to_id) return mainName;
    return nameOf.get(r.reply_to_id) || mainName;
  };

  const isOwner = (role?: string | null) => (role ?? '') === 'admin';

  return {
    id: `c-${row.id}`,
    // 账号有当前档案就优先用它 —— 改了署名/头像，历史留言跟着变
    name: row.acc_name || row.author,
    url: row.author_url ?? '',
    /**
     * 头像三档兜底：账号档案 → 留言时存下的 URL → 由邮箱哈希现拼。
     * 以前第三档交给前端（前端拿 `emailHash` 自己拼），等于把「无盐 md5(邮箱)」
     * 回给每个访客；现在服务端拼好，`emailHash` 不再外发（见下面的字段说明）。
     */
    avatar: row.acc_avatar || row.avatar || avatarFromHash(row.email_hash || ''),
    /** 站长本人的留言 —— 前台挂「站长」标（和 AI 标并列，两者可能同时出现） */
    admin: isOwner(row.acc_role),
    intro: row.body,
    at: new Date(row.ts).toISOString(),
    // `visible` = 已经收录进友链墙，其余（pending）显示「等我看看」。
    // 这两个状态都会返回给前端 —— 评论区是公开的，只是徽章不一样。
    // **spam 在上面那条 SQL 里就被排除了**：审核判成垃圾的不上前台，这是拦截唯一的落点。
    status: row.status === 'visible' ? ('approved' as const) : ('pending' as const),
    /**
     * 2026-11-14 起**不再下发**这个字段。
     *
     * 它等于 `md5(lower(email))`，公开回发就是一个「这个邮箱在不在本站」的
     * 枚举 oracle（对任意候选邮箱算一次 md5 比对即可）。头像已经由 `avatar`
     * 兜住了，前端不需要它。保留字段名（空串）是为了兼容还没更新的旧前端缓存。
     */
    emailHash: '',
    likes,
    /** 是不是自己发的（登录态才算得出来；未登录恒 false） */
    mine: Boolean(opts.mine),
    /** 自己点过赞没有 —— 由服务端给，前台不用再猜 */
    liked: Boolean(opts.liked),
    replies: replies.map((r) => ({
      id: `c-${r.id}`,
      name: r.acc_name || r.author,
      // notify = 0 表示访客主动取消了 @：不给 to，前端就不显示「@某某」
      to: toOf(r),
      avatar: r.acc_avatar || r.avatar || avatarFromHash(r.email_hash || ''),
      emailHash: '',
      // 站长在自己的回复上也挂标 —— 回自己的楼和回别人的楼都得认得出
      admin: isOwner(r.acc_role),
      intro: r.body,
      at: new Date(r.ts).toISOString(),
    })),
  };
}

/**
 * 读列表：**主楼和回复分两条查**，主楼支持游标分页。
 *
 * 以前是一条 `ORDER BY ts DESC LIMIT 300` 把两类一次捞出来，再在内存里按 parent_id 分组。
 * 那样有个迟早会炸的坑：回复也算进这 300 条 —— 活跃的楼里回复一多，
 * 老的主楼就被挤出窗口，然后**它下面的回复全部变成孤儿、整栋楼从页面上消失**。
 * 现在先取一页主楼，再按这批 id 取它们的回复，数量再多也不会互相挤。
 *
 * 分页用 **ts 游标**（`before`）而不是 OFFSET：翻页时有人刚发了新留言，
 * OFFSET 会让同一条重复出现两次；按时间往前取则永远接着上一页。
 *
 * JOIN accounts 是为了拿「当前」头像与署名（改名换头像后历史留言跟着变）；
 * 身份表还没迁移时 accounts 可能不存在，整段退到不带 JOIN 的老查询 ——
 * **列表永远不能因为「新功能没就位」而挂掉**。
 */
async function loadBoardRows(
  env: Env,
  opts: { limit: number; before: number },
): Promise<{ roots: CommentRow[]; reps: CommentRow[]; hasMore: boolean; nextBefore: number }> {
  const joined = `SELECT c.id, c.parent_id, c.author, c.author_url, c.avatar, c.body, c.status,
                          c.ts, c.email_hash, c.notify, c.account_id, c.reply_to_id,
                          a.avatar_url AS acc_avatar, a.display_name AS acc_name, a.role AS acc_role
                     FROM comments c LEFT JOIN accounts a ON a.id = c.account_id`;
  const plain = `SELECT id, parent_id, author, author_url, avatar, body, status,
                        ts, email_hash, notify, account_id
                   FROM comments`;

  type Page = { roots: CommentRow[]; reps: CommentRow[]; hasMore: boolean; nextBefore: number };

  async function run(sel: string, prefix: 'c.' | ''): Promise<Page> {
    // 多取一条只为判断「还有没有」，不返回给前端
    const older = opts.before > 0 ? ` AND ${prefix}ts < ?` : '';
    const stmt = env.DB.prepare(
      `${sel} WHERE ${prefix}post_slug = ? AND ${prefix}parent_id IS NULL
        AND ${prefix}status IN ('visible', 'pending')${older}
        ORDER BY ${prefix}ts DESC LIMIT ?`,
    );
    const roots = opts.before > 0
      ? await stmt.bind(SLUG, opts.before, opts.limit + 1).all<CommentRow>()
      : await stmt.bind(SLUG, opts.limit + 1).all<CommentRow>();

    const fetched = roots.results ?? [];
    const hasMore = fetched.length > opts.limit;
    const page = hasMore ? fetched.slice(0, opts.limit) : fetched;
    const ids = page.map((r) => r.id);
    if (ids.length === 0) return { roots: [], reps: [], hasMore: false, nextBefore: 0 };

    const reps = await env.DB.prepare(
      `${sel} WHERE ${prefix}post_slug = ? AND ${prefix}parent_id IN (${ids.map(() => '?').join(',')})
        AND ${prefix}status IN ('visible', 'pending') ORDER BY ${prefix}ts ASC`,
    )
      .bind(SLUG, ...ids)
      .all<CommentRow>();

    return {
      roots: page,
      reps: reps.results ?? [],
      hasMore,
      // 下一页从这一页最旧的那条往前取
      nextBefore: page[page.length - 1]?.ts ?? 0,
    };
  }

  try {
    return await run(joined, 'c.');
  } catch {
    // 0023/0024/0025 没跑时 accounts 或 reply_to_id 可能不存在 —— 退到最朴素的查询
    return run(plain, '');
  }
}

// ——————————————————————————————————————————————————————————
// GET /friends-board?limit=20&before=<ts>
// ——————————————————————————————————————————————————————————
export async function getFriendsBoard(request: Request, env: Env): Promise<Response> {
  const headers = withCors(request, env);
  try {
    const url = new URL(request.url);
    const asked = Number.parseInt(url.searchParams.get('limit') || '', 10);
    // 每页条数：默认 20，最多 50（再多首屏就没人愿意等了）
    const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 50) : 20;
    const before = Number(url.searchParams.get('before') || '') || 0;

    const { roots: rootRows, reps: replyRows, hasMore, nextBefore } = await loadBoardRows(env, {
      limit,
      before,
    });

    const likeRows = await env.DB.prepare(
      'SELECT comment_id, COUNT(*) AS n FROM friend_likes GROUP BY comment_id',
    ).all<{ comment_id: number; n: number }>();

    const likeMap = new Map<number, number>();
    for (const l of likeRows.results ?? []) likeMap.set(l.comment_id, l.n);

    // 当前访客已点过哪些 —— 一次查完，别在列表里逐条判。
    // 两种 key 都要认：没登录时点时存的是 IP|UA 哈希，登录后是 a<id>，
    // 只查一种会让「登录前点过的赞」在登录后忽然变成没点。
    const account = await currentAccount(request, env);
    const anonKey = await visitorKey(request, env);
    const likeKeys = account ? [likeKeyOf(anonKey, account), anonKey] : [anonKey];
    let likedSet = new Set<number>();
    try {
      const mine = await env.DB.prepare(
        `SELECT comment_id FROM friend_likes WHERE visitor IN (${likeKeys.map(() => '?').join(',')})`,
      )
        .bind(...likeKeys)
        .all<{ comment_id: number }>();
      likedSet = new Set((mine.results ?? []).map((r) => r.comment_id));
    } catch {
      /* 点赞表异常不该让整个列表挂掉 */
    }

    // 主楼保持「新的在前」，回复按时间正序（下面 for 里已经排过）
    const roots = rootRows;
    const byParent = new Map<number, CommentRow[]>();
    for (const r of replyRows) {
      if (r.parent_id === null) continue;
      const list = byParent.get(r.parent_id) ?? [];
      list.push(r);
      byParent.set(r.parent_id, list);
    }

    const items = roots.map((r) =>
      toEntry(
        r,
        // 楼中楼按时间正序，读起来才是对话顺序
        (byParent.get(r.id) ?? []).sort((a, b) => a.ts - b.ts),
        likeMap.get(r.id) ?? 0,
        {
          mine: Boolean(account) && r.account_id === account!.id,
          liked: likedSet.has(r.id),
        },
      ),
    );

    return json(
      {
        ok: true,
        items,
        /** 还有更早的没有 —— 前端据此显示「加载更多」 */
        hasMore,
        /** 下一页的游标（这一页最旧那条的 ts）；0 = 没有了 */
        nextBefore,
        // 前台据此决定「能不能发」以及要不要显示登录入口
        auth: {
          signedIn: Boolean(account),
          requireLogin: isOn(env.REQUIRE_LOGIN),
        },
      },
      200,
      headers,
    );
  } catch (err) {
    console.error('[friends-board] 读取失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'storage', message: '列表暂时读不出来' }, 502, headers);
  }
}

// ——————————————————————————————————————————————————————————
// POST /friends-board —— 留言
// ——————————————————————————————————————————————————————————
export async function postFriendsBoard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const headers = withCors(request, env);
  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return json({ ok: false, error: 'bad_request', message: '请求格式不对' }, 400, headers);
  }

  // 未登录能不能发：REQUIRE_LOGIN（默认开）。身份表还没迁移时 account 是 undefined，
  // 这种情况放行 —— 否则一次没跑完的迁移会把整个留言板锁死（见 currentAccount 注释）。
  const account = await currentAccount(request, env);
  if (isOn(env.REQUIRE_LOGIN) && account === null) {
    return json({ ...loginRequiredMessage() }, 401, headers);
  }

  const v = validate(body, Boolean(account));
  if (!v.ok) return json({ ok: false, error: 'validation', fields: v.fields }, 400, headers);

  const now = Date.now();
  const key = await visitorKey(request, env);

  // 限流：同一个「人」10 分钟最多 6 条（登录按账号、未登录按 IP|UA）
  if (await overRate(env, account, key, now)) {
    return json(
      { ok: false, error: 'rate_limited', message: '说得有点频繁，歇一会儿再来 ~' },
      429,
      headers,
    );
  }

  try {
    // 只认 32 位 hex；它只决定头像，所以前端传什么都不会影响安全
    const hashRaw = String(body.avatarHash ?? '').trim().toLowerCase();
    const hash = /^[a-f0-9]{32}$/.test(hashRaw) ? hashRaw : null;

    /**
     * 署名、站点、头像：**登录后一律以档案为准**，前端传的当作没看见。
     *
     * 以前是 `v.name || account.display_name`，看着只是「允许本条覆盖」，
     * 实际等于「任何登录用户都能把自己写成任意名字」—— 实测传一个 `name: "爱弥斯"`
     * 就顶着 AI 的名字和徽章发帖了。三格在登录后本来就不显示，这条口子没有任何产品价值。
     *
     * 邮箱反过来 —— 登录后一律不落明文，通知走 `accounts.email`。
     * 这样库里少一份明文邮箱，`email_hash` 也统一从账号来，迁移后的归并才对得上。
     */
    const author = account
      ? (account.display_name || account.email.split('@')[0] || '').slice(0, LIMITS.author)
      : v.v.name.slice(0, LIMITS.author);
    const site = account ? account.site_url || '' : v.v.url;
    const avatar = account ? account.avatar_url || avatarFromEmail(account.email) : v.v.avatar;
    const emailHash = account ? account.email_hash : hash;
    const emailPlain = account ? null : v.v.email || null;

    /**
     * 发布前审核 —— **每一条留言都会过这一遍**，没有开关。
     *
     * 这是唯一一条会挡住访客提交的路径，每条多花 200ms~1s（Jev 快，走聊天模型的慢）。
     * 规则（类别 / 阈值）在 /admin/review，判定逻辑在 admin/ai.ts 的 moderateComment。
     *
     * 三条原则：
     *   · 审核自己挂了（超时、key 失效、表没迁移）→ **放行**。宁可漏一条垃圾，
     *     也不能因为上游抖动就让留言板收不到话。
     *   · 命中就落 `spam`，**不丢** —— 前台不展示，收件箱「垃圾」里留着能复核，
     *     误判了站长点一下就放行。
     *   · 不告诉访客「你被拦了」。判定理由里常有「像广告」这种话，说出去很冲；
     *     何况告诉对方反而方便他改一版再试。
     */
    let status = 'pending';
    /** 判定结果留到 INSERT 之后 —— 记录表要 comment_id，此刻还没有 */
    let mod: ModerationResult | null = null;
    try {
      mod = await moderateComment(env, {
        id: 0,
        author,
        body: plainOf(v.v.intro),
        path: '/friends/',
        replies: [],
      });
      if (mod?.hit) {
        status = 'spam';
        console.log(`[friends-board] 审核拦截 ${author}：${mod.verdict} ${mod.score} >= ${mod.threshold}`);
      }
    } catch (e) {
      console.warn('[friends-board] 审核失败，照常收下：', e instanceof Error ? e.message : e);
    }

    /**
     * 新留言一律 `pending`（被审核拦下的落 `spam`）。
     *
     * ⚠️ 这里的 pending **不是「待审核」**，是「还没收录进友链墙」——
     * 前台徽章据此显示「等我看看」。内容审核在上一步已经做完了。
     */
    const deleteToken = newDeleteToken();

    const res = await env.DB.prepare(
      `INSERT INTO comments (post_slug, parent_id, author, email, email_hash, author_url, avatar, body, status, ts, ip_hash, delete_token, account_id)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        SLUG,
        author,
        emailPlain,
        emailHash,
        site || null,
        avatar || null,
        v.v.intro,
        status,
        now,
        key,
        deleteToken,
        account?.id ?? null,
      )
      .run();

    const id = Number(res.meta.last_row_id);

    /**
     * 拦了就要留下依据 —— 命中才写，一条留言最多一行。
     *
     * 走 waitUntil：这只是「记一笔证据」，不该让访客多等。
     * recordModeration 内部全 try/catch，记不下也不影响这条留言已经落库的事实。
     */
    if (mod?.hit) {
      ctx.waitUntil(
        recordModeration(env, {
          commentId: id,
          verdict: mod.verdict,
          score: mod.score,
          threshold: mod.threshold,
          reasons: mod.reasons,
          note: mod.note,
          model: mod.model,
          ms: mod.ms,
        }),
      );
    }

    /**
     * 小爱回一句。
     *
     * **必须走 waitUntil**：它要做 judge 判定 + 起草两次模型调用（1~3 秒），
     * await 在请求路径上会让访客盯着"提交中"发呆。
     * 失败也只是少一条回复 —— autoReplyTo 内部全 try/catch，不抛错。
     */
    // 被判成垃圾的就不叫小爱来接话了 —— 别在她嘴里复述一条广告
    if (status !== 'spam') ctx.waitUntil(autoReplyTo(env, id));

    // 通知站长（配了 RESEND_KEY + MAIL_TO 才发）
    if (env.MAIL_TO) {
      ctx.waitUntil(
        sendMail(env, {
          to: env.MAIL_TO,
          subject: `友链评论区 · ${author}`,
          text: `有人留了言：\n\n${plainOf(v.v.intro)}\n\n站点：${site || '（没填）'}\n\nhttps://www.qingwu.ink/links/#friends-comments`,
        }),
      );
      // 机会式补发积压的通知信：cron 每天才一次，有人留言说明站点正热，
      // 顺手把队列里到期的那几封发掉（只试 2 封，别在访客路径上耗时）
      ctx.waitUntil(flushOutbox(env, 2).catch(() => {}));
    }

    return json(
      {
        ok: true,
        entry: {
          id: `c-${id}`,
          name: author,
          url: site,
          avatar,
          // 自己发的这条也要立刻挂上站长标，别等刷新
          admin: account?.role === 'admin',
          intro: v.v.intro,
          at: new Date(now).toISOString(),
          status: 'pending',
          emailHash: emailHash ?? '',
          likes: 0,
          mine: true,
          liked: false,
          replies: [],
        },
        // ⚠️ 只在这里返回一次，列表接口永远不带它
        deleteToken,
      },
      200,
      headers,
    );
  } catch (err) {
    console.error('[friends-board] 写入失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'storage', message: '这条没能存下来，稍后重试' }, 502, headers);
  }
}

// ——————————————————————————————————————————————————————————
// POST /friends-board/:id/reply —— 回复（自动 @ + 邮件通知）
// ——————————————————————————————————————————————————————————
export async function postFriendReply(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  idParam: string,
): Promise<Response> {
  const headers = withCors(request, env);
  const parentId = Number(idParam);
  if (!Number.isInteger(parentId) || parentId <= 0) {
    return json({ ok: false, error: 'bad_request', message: '找不到这条留言' }, 400, headers);
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return json({ ok: false, error: 'bad_request', message: '请求格式不对' }, 400, headers);
  }

  const account = await currentAccount(request, env);
  if (isOn(env.REQUIRE_LOGIN) && account === null) {
    return json({ ...loginRequiredMessage() }, 401, headers);
  }

  const v = validate(body, Boolean(account));
  if (!v.ok) return json({ ok: false, error: 'validation', fields: v.fields }, 400, headers);

  const now = Date.now();
  const key = await visitorKey(request, env);

  // 回复与主楼共用同一个限流额度 —— 以前回复**完全没有闸门**，
  // 只要有一栋楼存在就能无限往里刷
  if (await overRate(env, account, key, now)) {
    return json(
      { ok: false, error: 'rate_limited', message: '说得有点频繁，歇一会儿再来 ~' },
      429,
      headers,
    );
  }

  // 只允许回复主楼（不做无限嵌套），并且要能拿到被回复者的邮箱用于通知。
  // 登录后留言不再存明文邮箱，所以从账号那边取 —— 这也是「邮箱只在一个地方」的好处。
  const parent = await env.DB.prepare(
    `SELECT c.id AS id, c.author AS author, c.email AS email, a.email AS acc_email, c.account_id AS acc_id
       FROM comments c LEFT JOIN accounts a ON a.id = c.account_id
      WHERE c.id = ? AND c.post_slug = ? AND c.parent_id IS NULL AND c.status != 'deleted'`,
  )
    .bind(parentId, SLUG)
    .first<{ id: number; author: string; email: string | null; acc_email: string | null; acc_id: number | null }>();

  if (!parent) {
    return json({ ok: false, error: 'not_found', message: '这条留言已经不在了' }, 404, headers);
  }

  /**
   * 是不是在回「某一条回复」。**仍然平铺在同一层**，只记一个指针（见 0025 迁移）。
   * 校验必须带上 `parent_id = ?`：不然可以拿别栋楼的回复 id 当目标，
   * 把通知发到不相干的人那里去。
   * 找不到（刚被删）就当回复主楼，不报错 —— 用户那边不该因为一条已删的回复发不出去。
   */
  const replyToId = Number(body.replyTo ?? 0) || 0;
  const target = replyToId
    ? await env.DB.prepare(
        `SELECT c.author AS author, c.email AS email, a.email AS acc_email, a.display_name AS acc_name,
                c.account_id AS acc_id
           FROM comments c LEFT JOIN accounts a ON a.id = c.account_id
          WHERE c.id = ? AND c.parent_id = ? AND c.post_slug = ? AND c.status != 'deleted'`,
      )
        .bind(replyToId, parentId, SLUG)
        .first<{
          author: string;
          email: string | null;
          acc_email: string | null;
          acc_name: string | null;
          acc_id: number | null;
        }>()
    : null;

  /** 被回复的人（名字用于 @ 显示，邮箱用于发信）；没有二级目标就是主楼作者 */
  const targetName = target ? target.acc_name || target.author : parent.author;

  /**
   * 通知收件人 —— **只给「登录账号」的邮箱发信**。
   *
   * 2026-11-14 加固：匿名留言的 `email` 是访客随手填的、从未验证过，
   * 以前拿它当收件人 = 任何人填上受害者邮箱留一条言、再自己回一条，
   * 就能用 `noreply@qingwu.ink` 把攻击者写的正文投递到受害者信箱
   * （骚扰 + 消耗发信域名信誉）。现在只有 `account_id` 非空（邮箱经 OTP 验过）才发。
   */
  const targetEmail = target
    ? target.acc_id
      ? target.acc_email || null
      : null
    : parent.acc_id
      ? parent.acc_email || null
      : null;

  try {
    // 默认 @ 对方（发信）；访客手动取消就是 false
    const notify = body.notify === false ? 0 : 1;

    // 同留言：登录后署名/站点/头像一律取档案，不接受前端覆盖（防冒充）
    const author = account
      ? (account.display_name || account.email.split('@')[0] || '').slice(0, LIMITS.author)
      : v.v.name.slice(0, LIMITS.author);
    const site = account ? account.site_url || '' : v.v.url;
    const avatar = account ? account.avatar_url || avatarFromEmail(account.email) : v.v.avatar;

    /**
     * 回复也要过审。
     *
     * ⚠️ 这里原来直接写死 `status='visible'` —— 只要主楼过了审，回复就是一条
     * **完全不过筛的通道**：广告、辱骂随便回，一样挂在前台，站长连拦截记录都看不到。
     * 现在和主楼同一套：判一遍，命中落 `spam`（前台不展示，收件箱里能复核）。
     * 审核自己挂了照常放行 —— 规则同主楼，宁可漏一条也不让留言板发不出话。
     */
    let status = 'visible';
    let mod: ModerationResult | null = null;
    try {
      mod = await moderateComment(env, {
        id: 0,
        author,
        body: plainOf(v.v.intro),
        path: '/friends/',
        replies: [],
      });
      if (mod?.hit) {
        status = 'spam';
        console.log(`[friends-board] 回复被拦 ${author}：${mod.verdict} ${mod.score} >= ${mod.threshold}`);
      }
    } catch (e) {
      console.warn('[friends-board] 回复审核失败，照常收下：', e instanceof Error ? e.message : e);
    }

    const res = await env.DB.prepare(
      `INSERT INTO comments (post_slug, parent_id, author, email, email_hash, author_url, avatar, body, status, ts, ip_hash, notify, account_id, reply_to_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        SLUG,
        parentId,
        author,
        account ? null : v.v.email || null,
        account ? account.email_hash : null,
        site || null,
        avatar || null,
        v.v.intro,
        status,
        now,
        key,
        notify,
        account?.id ?? null,
        target ? replyToId : null,
      )
      .run();

    const id2 = Number(res.meta.last_row_id);

    // 被拦下的回复留一笔依据（与主楼同一张表、同一套口径）
    if (mod?.hit) {
      ctx.waitUntil(
        recordModeration(env, {
          commentId: id2,
          verdict: mod.verdict,
          score: mod.score,
          threshold: mod.threshold,
          reasons: mod.reasons,
          note: mod.note,
          model: mod.model,
          ms: mod.ms,
        }),
      );
    }

    // 通知被回复的人：他登录了就用账号邮箱，老留言用当时填的邮箱。
    // 二级回复通知的是**被回复的那条**，不是主楼 —— 不然一句「谢谢」会把楼主也叫起来。
    // notify = 0 表示访客主动取消了 @，那就不打扰对方。
    // 被判成垃圾的也不发 —— 别替一条广告去敲人家的门。
    const notifyTo = targetEmail;
    if (notify && notifyTo && status !== 'spam') {
      ctx.waitUntil(
        sendMail(env, {
          to: notifyTo,
          // 用回复者的名字，别写死「清吾」—— 站长现在会用「爱弥斯」的身份回复
          subject: `${author} 回复了你在友链评论区的留言`,
          text: boardMailText({
            kind: 'reply',
            from: author,
            toName: targetName,
            // 邮件是纯文本，别把 Markdown 标记原样塞进去
            body: plainOf(v.v.intro),
            site,
          }),
        }),
      );
      // 同上：机会式补发（回复场景下被回复的人更在等这封信）
      ctx.waitUntil(flushOutbox(env, 2).catch(() => {}));
    }

    return json(
      {
        ok: true,
        reply: {
          id: `c-${Number(res.meta.last_row_id)}`,
          name: author,
          admin: account?.role === 'admin',
          // @ 的是「被回复的那条」的作者；回主楼时就是主楼作者
          to: notify ? targetName : '',
          replyToId: target ? `c-${replyToId}` : '',
          // 访客回复一般没有头像；站长用爱弥斯身份回复时带上，前端就显示那张脸
          avatar: avatar || '',
          // 头像挂了的时候要用它换 Cravatar —— 回复也走三档兜底，不能只给首字
          emailHash: account ? account.email_hash : null,
          intro: v.v.intro,
          at: new Date(now).toISOString(),
        },
      },
      200,
      headers,
    );
  } catch (err) {
    console.error('[friends-board] 回复失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'storage', message: '回复没能存下来，稍后重试' }, 502, headers);
  }
}

// ——————————————————————————————————————————————————————————
// POST /friends-board/:id/like —— 点赞（按访客去重，可取消）
// ——————————————————————————————————————————————————————————
export async function postFriendLike(
  request: Request,
  env: Env,
  idParam: string,
): Promise<Response> {
  const headers = withCors(request, env);
  const commentId = Number(idParam);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    return json({ ok: false, error: 'bad_request' }, 400, headers);
  }

  /**
   * 先确认这条留言真的在。
   *
   * 以前不查就写 `friend_likes` —— 任何 id 都能点出一行「赞」，
   * 表可以被无意义地撑大（`SELECT COUNT(*) WHERE comment_id=?` 还会跟着变慢），
   * 而且回给前端一个并不属于任何留言的计数。
   */
  const exists = await env.DB.prepare(
    `SELECT 1 AS one FROM comments WHERE id = ? AND post_slug = ? AND status != 'deleted'`,
  )
    .bind(commentId, SLUG)
    .first<{ one: number }>();
  if (!exists) return json({ ok: false, error: 'not_found' }, 404, headers);

  // 登录后按账号去重（换设备也算同一个人的赞）；未登录仍按 IP|UA 哈希
  const account = await currentAccount(request, env);
  const anonKey = await visitorKey(request, env);
  /**
   * **同一个人可能占两个 key**：没登录时点是 `IP|UA 哈希`，登录后是 `a<id>`。
   * 只查一种的话，同一个人登录前后各点一次就算两票 —— 实测确实能刷出 +2。
   * 所以取消/判重都同时认这两种；真正插入时只写账号那一个（登录后身份是账号）。
   */
  const keys = account ? [likeKeyOf(anonKey, account), anonKey] : [anonKey];
  const inClause = keys.map(() => '?').join(',');

  try {
    const existing = await env.DB.prepare(
      `SELECT visitor FROM friend_likes WHERE comment_id = ? AND visitor IN (${inClause})`,
    )
      .bind(commentId, ...keys)
      .all<{ visitor: string }>();

    if ((existing.results ?? []).length > 0) {
      // 全删：历史数据里可能两种 key 都在，取消就该整个取消掉
      await env.DB.prepare(
        `DELETE FROM friend_likes WHERE comment_id = ? AND visitor IN (${inClause})`,
      )
        .bind(commentId, ...keys)
        .run();
    } else {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO friend_likes (comment_id, visitor, ts, account_id) VALUES (?, ?, ?, ?)',
      )
        .bind(commentId, keys[0]!, Date.now(), account?.id ?? null)
        .run();
    }

    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM friend_likes WHERE comment_id = ?')
      .bind(commentId)
      .first<{ n: number }>();

    return json(
      { ok: true, liked: (existing.results ?? []).length === 0, likes: cnt?.n ?? 0 },
      200,
      headers,
    );
  } catch (err) {
    console.error('[friends-board] 点赞失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'storage' }, 502, headers);
  }
}

// ——————————————————————————————————————————————————————————
// DELETE /friends-board/:id —— 留言人删自己的留言
// ——————————————————————————————————————————————————————————
//
// 凭据是创建时发的那串 token（存 localStorage）。校验不过一律 403，
// 不区分「没这条」和「不是你的」以外的情况，免得能拿来探测 id 是否存在。
//
// 删除是**软删**（status='deleted'），GET 的 `status != 'deleted'` 会过滤掉；
// 需要恢复就直接改状态，比硬删安全。
export async function deleteFriendComment(
  request: Request,
  env: Env,
  idParam: string,
): Promise<Response> {
  const headers = withCors(request, env);
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, error: 'bad_request' }, 400, headers);
  }

  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return json({ ok: false, error: 'bad_request', message: '请求格式不对' }, 400, headers);
  }

  const token = String(body.token ?? '').trim();
  // 凭证可以不给 —— 登录用户直接凭 account_id 判，见下面
  if (token && !/^[a-f0-9]{32}$/i.test(token)) {
    return json({ ok: false, error: 'forbidden', message: '这个删除凭证不对' }, 403, headers);
  }

  const row = await env.DB.prepare(
    'SELECT delete_token, status, account_id, parent_id FROM comments WHERE id = ? AND post_slug = ?',
  )
    .bind(id, SLUG)
    .first<{ delete_token: string | null; status: string; account_id: number | null; parent_id: number | null }>();

  if (!row) {
    return json({ ok: false, error: 'not_found', message: '这条留言已经不在了' }, 404, headers);
  }

  /**
   * 判定顺序：**账号 → 删除凭证**。
   *
   * 账号优先是迁移之后的主路径（换设备也能删）；`delete_token` 留着兜底 ——
   * 迁移前的匿名留言、以及没留邮箱的老留言，仍然只有那台设备能删。
   */
  const account = await currentAccount(request, env);
  const byAccount = Boolean(account) && row.account_id === account!.id;
  const byToken = Boolean(token) && Boolean(row.delete_token) && (await secretEqual(token, row.delete_token!));

  if (!byAccount && !byToken) {
    return json(
      { ok: false, error: 'forbidden', message: '只有留言的人自己能删这条' },
      403,
      headers,
    );
  }
  // 已经删过就直接当成功，免得多点两下报错
  if (row.status === 'deleted') return json({ ok: true }, 200, headers);

  /**
   * 删主楼就把整栋一起删 —— 光把主楼置 deleted，它的回复会变成一串
   * 没有主楼的孤儿：列表里看不见（分组时找不到父楼），**但谁也删不掉**
   * （接口只能按 id 一条条删，而它们不在任何列表里）。
   * 删单条回复时 `parent_id` 非空，就只删它自己。
   */
  const stmts = [env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?").bind(id)];
  if (row.parent_id === null) {
    stmts.push(
      env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE parent_id = ? AND post_slug = ?").bind(
        id,
        SLUG,
      ),
    );
  }
  await env.DB.batch(stmts);

  return json({ ok: true }, 200, headers);
}
