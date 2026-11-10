// 清吾 · 后台评论管理
//
// 直接读写 `comments` 表 —— 和友链留言板是同一张（见 docs/决策-评论系统.md）：
// 后台的「回复」就是插一条 parent_id 指向原留言的记录，前台楼中楼天然认它。
//
// 只有三件事：列表（筛选/搜索/分页）、回复、改审核状态。删除留给前台作者自己用 token 删。

import type { Env } from '../types';
import { json } from '../util';
import type { Admin } from './auth';

const PAGE_SIZE = 20;
const MAX_REPLY_LEN = 500;
const VALID_STATUS = new Set(['visible', 'pending', 'spam', 'deleted']);

/**
 * 后台回复的唯一身份：爱弥斯（小爱）。
 *
 * 不另开账号表 —— 前台 `FriendsBoard` 判 AI 发言的规则是
 * **署名等于「爱弥斯」或头像路径里带 `images/emis/avatar`**，两条任一命中就挂 AI 小标，
 * 所以这里只要把 author / avatar 填对，前台自然认。
 *
 * 三处必须一致：`FriendsBoard.tsx` 的 `AI_AUTHOR`、这里、以及 wrangler.toml 的
 * `AI_PERSONA_NAME`。改名字改这三处，别只改一处。
 */
const AI_DEFAULT_NAME = '爱弥斯';
const AI_DEFAULT_AVATAR = 'https://www.qingwu.ink/images/emis/avatar.png';
const SITE_DEFAULT = 'https://www.qingwu.ink';

export interface Identity {
  author: string;
  avatar: string;
  url: string;
}

/**
 * 「小爱」的署名与头像。
 *
 * 后台手动回复（replyToComment）和访客留言后的自动回复（ai.ts 的 autoReplyTo）
 * **必须用同一份**，否则两边写进 comments 的 author 不一样，前台只认其中一种，
 * 另一种就不挂 AI 小标了。
 */
export function identityOf(env: Env): Identity {
  const str = (v: string | undefined): string => String(v ?? '').trim();
  return {
    author: str(env.AI_PERSONA_NAME) || AI_DEFAULT_NAME,
    avatar: str(env.AI_PERSONA_AVATAR) || AI_DEFAULT_AVATAR,
    url: str(env.SITE_URL) || SITE_DEFAULT,
  };
}

/** post_slug → 前台路径。目前只有留言板在用这张表，文章评论接进来后这里要补分支。 */
function pathOf(slug: string): string {
  if (slug === 'friends') return '/friends/';
  if (slug === 'guestbook') return '/guestbook/';
  if (slug.startsWith('/')) return slug;
  return `/blog/${slug}/`;
}

interface CommentRow {
  id: number;
  post_slug: string;
  parent_id: number | null;
  author: string;
  body: string;
  status: string;
  ts: number;
  author_url: string | null;
  avatar: string | null;
  replies: number;
}

function toItem(r: CommentRow) {
  return {
    id: r.id,
    author: r.author,
    body: r.body,
    slug: r.post_slug,
    path: pathOf(r.post_slug),
    status: r.status,
    ts: r.ts,
    authorUrl: r.author_url,
    avatar: r.avatar,
    replies: r.replies,
  };
}

// ——————————————————————————————————————————————————————————
// 列表
// ——————————————————————————————————————————————————————————
export async function listComments(request: Request, env: Env, _admin: Admin): Promise<Response> {
  const url = new URL(request.url);
  const status = (url.searchParams.get('status') || 'all').trim();
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);

  // 只列顶层留言，回复数用子查询带出来 —— 收件箱要的是「一条待处理」，不是整个楼层
  const where: string[] = ['c.parent_id IS NULL'];
  const args: unknown[] = [];

  if (VALID_STATUS.has(status)) {
    where.push('c.status = ?');
    args.push(status);
  } else {
    where.push("c.status != 'deleted'");
  }
  if (q) {
    where.push('(c.body LIKE ? OR c.author LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.join(' AND ');

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM comments c WHERE ${whereSql}`)
    .bind(...args)
    .first<{ n: number }>();
  const total = totalRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pages);

  const rows = await env.DB.prepare(
    `SELECT c.id, c.post_slug, c.parent_id, c.author, c.body, c.status, c.ts, c.author_url, c.avatar,
            (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id AND r.status != 'deleted') AS replies
       FROM comments c
      WHERE ${whereSql}
      ORDER BY c.ts DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(...args, PAGE_SIZE, (safePage - 1) * PAGE_SIZE)
    .all<CommentRow>();

  // 各状态计数，给顶部 tab 上的角标用
  const counts = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM comments WHERE parent_id IS NULL GROUP BY status`,
  ).all<{ status: string; n: number }>();

  const byStatus: Record<string, number> = { all: 0 };
  for (const r of counts.results ?? []) {
    byStatus[r.status] = r.n;
    if (r.status !== 'deleted') byStatus.all = (byStatus.all ?? 0) + r.n;
  }

  return json({
    ok: true,
    total,
    page: safePage,
    pages,
    pageSize: PAGE_SIZE,
    counts: byStatus,
    items: (rows.results ?? []).map(toItem),
  });
}

// ——————————————————————————————————————————————————————————
// 某个楼层：原留言 + 已有回复（展开时用）
// ——————————————————————————————————————————————————————————
export async function getThread(_request: Request, env: Env, _admin: Admin, id: number): Promise<Response> {
  const root = await env.DB.prepare(
    `SELECT id, post_slug, parent_id, author, body, status, ts, author_url, avatar, 0 AS replies
       FROM comments WHERE id = ?`,
  )
    .bind(id)
    .first<CommentRow>();
  if (!root) return json({ ok: false, reason: 'not_found' }, 404);

  const replies = await env.DB.prepare(
    `SELECT id, post_slug, parent_id, author, body, status, ts, author_url, avatar, 0 AS replies
       FROM comments WHERE parent_id = ? AND status != 'deleted' ORDER BY ts ASC`,
  )
    .bind(id)
    .all<CommentRow>();

  return json({ ok: true, root: toItem(root), replies: (replies.results ?? []).map(toItem) });
}

// ——————————————————————————————————————————————————————————
// 回复
// ——————————————————————————————————————————————————————————
export async function replyToComment(
  request: Request,
  env: Env,
  admin: Admin,
  id: number,
): Promise<Response> {
  let bodyText = '';
  try {
    const v = (await request.json()) as { body?: unknown };
    bodyText = String(v?.body ?? '').trim();
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }
  if (!bodyText) return json({ ok: false, reason: 'empty' }, 400);
  if (bodyText.length > MAX_REPLY_LEN) {
    return json({ ok: false, reason: 'too_long', message: `回复最多 ${MAX_REPLY_LEN} 字` }, 400);
  }

  const parent = await env.DB.prepare('SELECT id, post_slug FROM comments WHERE id = ?')
    .bind(id)
    .first<{ id: number; post_slug: string }>();
  if (!parent) return json({ ok: false, reason: 'not_found' }, 404);

  const who = identityOf(env);
  const now = Date.now();
  // email 一律不填 —— 那是站长的邮箱，不该挂在 AI 的发言上（通知与 Gravatar 都会串）。
  const res = await env.DB.prepare(
    `INSERT INTO comments (post_slug, parent_id, author, author_url, avatar, body, status, ts, notify)
     VALUES (?, ?, ?, ?, ?, ?, 'visible', ?, 0)`,
  )
    .bind(parent.post_slug, parent.id, who.author, who.url, who.avatar, bodyText, now)
    .run();

  console.log(`[admin] ${admin.username} 以 ${who.author} 身份回复了 #${id}`);
  return json({ ok: true, id: res.meta?.last_row_id ?? null, ts: now, author: who.author });
}

// ——————————————————————————————————————————————————————————
// 改审核状态
// ——————————————————————————————————————————————————————————
export async function setCommentStatus(
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
  if (!VALID_STATUS.has(status)) return json({ ok: false, reason: 'bad_status' }, 400);

  const res = await env.DB.prepare('UPDATE comments SET status = ? WHERE id = ?').bind(status, id).run();
  if (!res.meta?.changes) return json({ ok: false, reason: 'not_found' }, 404);
  return json({ ok: true, status });
}
