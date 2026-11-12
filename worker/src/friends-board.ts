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
import { avatarFromEmail } from './auth/avatar';
import { sessionUser, type AccountRow } from './auth/store';
import { loginRequiredMessage } from './auth/index';

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

function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** 匿名访客标识（IP + UA 哈希截断）—— 点赞去重与限流用，不落明文 */
async function visitorKey(request: Request, env: Env): Promise<string> {
  const data = new TextEncoder().encode(
    `${env.HIT_IP_SALT || 'dev'}|${clientIp(request)}|${request.headers.get('user-agent') || ''}`,
  );
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
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

/** 组装成前端要的公开形状（字段名与 `src/lib/friendsBoard.ts` 的 FriendEntry 对齐） */
function toEntry(
  row: CommentRow,
  replies: CommentRow[],
  likes: number,
  opts: { mine?: boolean; liked?: boolean } = {},
) {
  return {
    id: `c-${row.id}`,
    name: row.author,
    url: row.author_url ?? '',
    avatar: row.avatar ?? '',
    intro: row.body,
    at: new Date(row.ts).toISOString(),
    // `visible` = 已经收录进友链墙，其余（pending）显示「等我看看」。
    // 这两个状态都会返回给前端 —— 评论区是公开的，只是徽章不一样。
    // **spam 在上面那条 SQL 里就被排除了**：审核判成垃圾的不上前台，这是拦截唯一的落点。
    status: row.status === 'visible' ? ('approved' as const) : ('pending' as const),
    emailHash: row.email_hash ?? '',
    likes,
    /** 是不是自己发的（登录态才算得出来；未登录恒 false） */
    mine: Boolean(opts.mine),
    /** 自己点过赞没有 —— 由服务端给，前台不用再猜 */
    liked: Boolean(opts.liked),
    replies: replies.map((r) => ({
      id: `c-${r.id}`,
      name: r.author,
      // notify = 0 表示访客主动取消了 @：不给 to，前端就不显示「@某某」
      to: r.notify === 0 ? '' : row.author,
      avatar: r.avatar ?? '',
      intro: r.body,
      at: new Date(r.ts).toISOString(),
    })),
  };
}

// ——————————————————————————————————————————————————————————
// GET /friends-board
// ——————————————————————————————————————————————————————————
export async function getFriendsBoard(request: Request, env: Env): Promise<Response> {
  const headers = withCors(request, env);
  try {
    const rows = await env.DB.prepare(
      `SELECT id, parent_id, author, author_url, avatar, body, status, ts, email_hash, notify, account_id
       FROM comments WHERE post_slug = ? AND status IN ('visible', 'pending')
       ORDER BY ts DESC LIMIT 300`,
    )
      .bind(SLUG)
      .all<CommentRow>();

    const likeRows = await env.DB.prepare(
      'SELECT comment_id, COUNT(*) AS n FROM friend_likes GROUP BY comment_id',
    ).all<{ comment_id: number; n: number }>();

    const likeMap = new Map<number, number>();
    for (const l of likeRows.results ?? []) likeMap.set(l.comment_id, l.n);

    // 当前访客已点过哪些 —— 一次查完，别在列表里逐条判
    const account = await currentAccount(request, env);
    const mineKey = likeKeyOf(await visitorKey(request, env), account);
    let likedSet = new Set<number>();
    try {
      const mine = await env.DB.prepare('SELECT comment_id FROM friend_likes WHERE visitor = ?')
        .bind(mineKey)
        .all<{ comment_id: number }>();
      likedSet = new Set((mine.results ?? []).map((r) => r.comment_id));
    } catch {
      /* 点赞表异常不该让整个列表挂掉 */
    }

    const all = rows.results ?? [];
    const roots = all.filter((r) => r.parent_id === null);
    const byParent = new Map<number, CommentRow[]>();
    for (const r of all) {
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

  // 限流：同一访客 10 分钟最多 6 条
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM comments
     WHERE post_slug = ? AND ip_hash = ? AND ts > ?`,
  )
    .bind(SLUG, key, now - RATE_WINDOW_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_MAX) {
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
     * 署名、站点、头像：**登录后以档案为准**（前端填的只作本条覆盖）。
     *
     * 邮箱反过来 —— 登录后一律不落明文，通知走 `accounts.email`。
     * 这样库里少一份明文邮箱，`email_hash` 也统一从账号来，迁移后的归并才对得上。
     */
    const author = (v.v.name || account?.display_name || account?.email.split('@')[0] || '').slice(
      0,
      LIMITS.author,
    );
    const site = v.v.url || account?.site_url || '';
    const avatar = v.v.avatar || account?.avatar_url || (account ? avatarFromEmail(account.email) : '');
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

  // 只允许回复主楼（不做无限嵌套），并且要能拿到被回复者的邮箱用于通知。
  // 登录后留言不再存明文邮箱，所以从账号那边取 —— 这也是「邮箱只在一个地方」的好处。
  const parent = await env.DB.prepare(
    `SELECT c.id AS id, c.author AS author, c.email AS email, a.email AS acc_email
       FROM comments c LEFT JOIN accounts a ON a.id = c.account_id
      WHERE c.id = ? AND c.post_slug = ? AND c.parent_id IS NULL AND c.status != 'deleted'`,
  )
    .bind(parentId, SLUG)
    .first<{ id: number; author: string; email: string | null; acc_email: string | null }>();

  if (!parent) {
    return json({ ok: false, error: 'not_found', message: '这条留言已经不在了' }, 404, headers);
  }

  try {
    // 默认 @ 对方（发信）；访客手动取消就是 false
    const notify = body.notify === false ? 0 : 1;

    const author = (v.v.name || account?.display_name || account?.email.split('@')[0] || '').slice(
      0,
      LIMITS.author,
    );
    const site = v.v.url || account?.site_url || '';
    const avatar = v.v.avatar || account?.avatar_url || (account ? avatarFromEmail(account.email) : '');

    const res = await env.DB.prepare(
      `INSERT INTO comments (post_slug, parent_id, author, email, email_hash, author_url, avatar, body, status, ts, ip_hash, notify, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?, ?, ?)`,
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
        now,
        key,
        notify,
        account?.id ?? null,
      )
      .run();

    // 通知被回复的人：他登录了就用账号邮箱，老留言用当时填的邮箱。
    // 站长回复时不抄送自己，避免每回一句都收到一封信。
    // notify = 0 表示访客主动取消了 @，那就不打扰对方。
    const notifyTo = parent.acc_email || parent.email;
    if (notify && notifyTo) {
      ctx.waitUntil(
        sendMail(env, {
          to: notifyTo,
          // 用回复者的名字，别写死「清吾」—— 站长现在会用「爱弥斯」的身份回复
          subject: `${author} 回复了你在友链评论区的留言`,
          text: boardMailText({
            kind: 'reply',
            from: author,
            toName: parent.author,
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
          to: notify ? parent.author : '',
          // 访客回复一般没有头像；站长用爱弥斯身份回复时带上，前端就显示那张脸
          avatar: avatar || '',
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

  // 登录后按账号去重（换设备也算同一个人的赞）；未登录仍按 IP|UA 哈希
  const account = await currentAccount(request, env);
  const key = likeKeyOf(await visitorKey(request, env), account);

  try {
    const existing = await env.DB.prepare(
      'SELECT 1 AS x FROM friend_likes WHERE comment_id = ? AND visitor = ?',
    )
      .bind(commentId, key)
      .first<{ x: number }>();

    if (existing) {
      await env.DB.prepare('DELETE FROM friend_likes WHERE comment_id = ? AND visitor = ?')
        .bind(commentId, key)
        .run();
    } else {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO friend_likes (comment_id, visitor, ts, account_id) VALUES (?, ?, ?, ?)',
      )
        .bind(commentId, key, Date.now(), account?.id ?? null)
        .run();
    }

    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM friend_likes WHERE comment_id = ?')
      .bind(commentId)
      .first<{ n: number }>();

    return json({ ok: true, liked: !existing, likes: cnt?.n ?? 0 }, 200, headers);
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
    'SELECT delete_token, status, account_id FROM comments WHERE id = ? AND post_slug = ?',
  )
    .bind(id, SLUG)
    .first<{ delete_token: string | null; status: string; account_id: number | null }>();

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

  await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?").bind(id).run();
  return json({ ok: true }, 200, headers);
}
