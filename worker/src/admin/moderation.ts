// 清吾 · 拦截记录
//
// 由来：审核上线之后，收件箱只告诉站长「这条是垃圾」，说不出**为什么**。
// 命中哪一类、多少分、当时的阈值是多少、模型给了什么理由 —— 这些在日志里滚掉了，
// 而它们恰好是「拦得对不对」唯一能复盘的东西。
//
// 两条纪律，和 publish.ts 一致：
//   1) **记录失败绝不影响主流程**。留言该不该收下的判断早在调这里之前就定了，
//      记不下日志是「少了一条证据」，不是「这次提交失败」。
//   2) **一条留言最多一行**（comment_id 唯一）。审核只在提交那一刻发生一次；
//      后来人工放行也不会删这行 —— 「当时判成垃圾、后来放了」本身就是有用的事实。
//      当前是否还拦着看 comments.status，一张表只回答一个问题。
//
// 历史数据没有这行：拦截功能上线前就落成 spam 的留言，列表里用 comments 现补
// （见 listBlocked 的第二段查询），否则站长会以为「一条都没拦过」。

import type { Env } from '../types';
import { dayKey, json } from '../util';
import type { Admin } from './auth';

/** 一条判定结果 —— 字段就是 moderation_log 的列 */
export interface ModerationRecord {
  commentId: number;
  verdict: string;
  score: number;
  threshold: number;
  reasons: string[];
  note?: string;
  model?: string;
  ms?: number;
}

/**
 * 记一笔。**永不抛错**。
 *
 * 表还没迁移时这里会静默失败 —— 调用方不需要为此加 try。
 */
export async function recordModeration(env: Env, rec: ModerationRecord): Promise<void> {
  if (!rec.commentId || rec.commentId <= 0) return;
  try {
    await env.DB.prepare(
      `INSERT INTO moderation_log
         (comment_id, verdict, score, threshold, reasons, note, model, ms, day, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (comment_id) DO NOTHING`,
    )
      .bind(
        rec.commentId,
        rec.verdict,
        Math.round(rec.score) || 0,
        Math.round(rec.threshold) || 0,
        JSON.stringify((rec.reasons ?? []).slice(0, 3)),
        rec.note ?? null,
        rec.model ?? null,
        rec.ms ?? null,
        dayKey(Date.now()),
        Date.now(),
      )
      .run();
  } catch (e) {
    console.warn('[moderation] 拦截记录没写进去：', e instanceof Error ? e.message : e);
  }
}

/** 列表里的一行 */
export interface BlockedItem {
  id: number;
  commentId: number;
  verdict: string | null;
  score: number | null;
  threshold: number | null;
  reasons: string[];
  note: string;
  model: string;
  ms: number | null;
  ts: number;
  author: string;
  body: string;
  path: string;
  /** 当前状态：spam = 还拦着，其余 = 已经被人工放行 */
  status: string;
  /** 有没有判定详情。false = 审核功能上线前的旧数据，只有结论没有依据 */
  detailed: boolean;
}

/** `friends` → `/friends/`，与 comments.ts 的 pathOf 同口径（这里只要个可读字符串） */
function pathOfSlug(slug: string): string {
  const s = slug.trim().replace(/^\/+|\/+$/g, '');
  if (!s) return '/';
  if (s === 'friends') return '/friends/';
  return `/${s}/`;
}

function reasonsOf(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? '[]')) as unknown;
    return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 3) : [];
  } catch {
    return [];
  }
}

/**
 * 两段查询合并成一份「虚拟表」：
 *   ① moderation_log 里有判定详情的；
 *   ② comments 里 status='spam' 但日志表没对应行的（功能上线前的历史）。
 *
 * 用 UNION ALL 而不是查两次再在内存里拼排序 —— 后者分页会错：
 * 两段各取 N 条，合并后再切第 2 页，第 1 页的尾部会重复出现。
 * 列数、列序必须与下方 `.all<...>()` 的泛型一致。
 */
const UNION_SQL = `
  SELECT m.id AS id, m.comment_id AS comment_id, m.verdict AS verdict,
         m.score AS score, m.threshold AS threshold, m.reasons AS reasons,
         m.note AS note, m.model AS model, m.ms AS ms, m.ts AS ts,
         c.author AS author, c.body AS body, c.post_slug AS post_slug,
         c.status AS cstatus, 1 AS detailed
    FROM moderation_log m
    LEFT JOIN comments c ON c.id = m.comment_id
  UNION ALL
  SELECT 0, c.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, c.ts,
         c.author, c.body, c.post_slug, c.status, 0
    FROM comments c
   WHERE c.status = 'spam'
     AND NOT EXISTS (SELECT 1 FROM moderation_log m WHERE m.comment_id = c.id)
`;

/** 迁移没跑时的退路：只有 comments，没有判定详情 */
const SPAM_ONLY_SQL = `
  SELECT c.id, c.author, c.body, c.post_slug, c.status, c.ts
    FROM comments c
   WHERE c.status = 'spam'
`;

export interface BlockedPage {
  items: BlockedItem[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
}

type RawBlocked = {
  id: number;
  comment_id: number;
  verdict: string | null;
  score: number | null;
  threshold: number | null;
  reasons: string | null;
  note: string | null;
  model: string | null;
  ms: number | null;
  ts: number;
  author: string | null;
  body: string | null;
  post_slug: string | null;
  cstatus: string | null;
  detailed: number;
};

function toItem(x: RawBlocked): BlockedItem {
  const detailed = Number(x.detailed) === 1;
  return {
    id: Number(x.id) || 0,
    commentId: x.comment_id,
    verdict: x.verdict,
    score: x.score,
    threshold: x.threshold,
    reasons: detailed ? reasonsOf(x.reasons) : [],
    note: x.note ?? '',
    model: x.model ?? '',
    ms: x.ms,
    ts: x.ts,
    author: x.author ?? '（留言已删）',
    body: String(x.body ?? '').slice(0, 120),
    path: x.post_slug ? pathOfSlug(x.post_slug) : '',
    status: x.cstatus ?? 'spam',
    detailed,
  };
}

/**
 * 拦截记录，分页。
 *
 * 站长要求「限制一下一页显示多少条信息」—— 原来是一次给 20 条到最后，
 * 几十条之后这一页要滚很久，也没法知道总共拦过多少。
 */
export async function listBlocked(env: Env, page = 1, pageSize = 10): Promise<BlockedPage> {
  const size = Math.max(1, Math.min(100, Math.trunc(pageSize) || 10));
  const p0 = Math.max(1, Math.trunc(page) || 1);

  // —— 主路：两张表都在 ——
  try {
    const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${UNION_SQL})`)
      .first<{ n: number }>();
    const total = Number(countRow?.n ?? 0);
    const pages = Math.max(1, Math.ceil(total / size));
    const p = Math.min(p0, pages);

    const r = await env.DB.prepare(`SELECT * FROM (${UNION_SQL}) ORDER BY ts DESC LIMIT ? OFFSET ?`)
      .bind(size, (p - 1) * size)
      .all<RawBlocked>();

    return { items: (r.results ?? []).map(toItem), total, page: p, pages, pageSize: size };
  } catch {
    /* moderation_log 还不存在 —— 走下面那条只查 comments 的路 */
  }

  // —— 退路：只有历史垃圾留言，没有判定详情 ——
  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${SPAM_ONLY_SQL})`)
    .first<{ n: number }>();
  const total = Number(countRow?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(p0, pages);

  const r = await env.DB.prepare(`SELECT * FROM (${SPAM_ONLY_SQL}) ORDER BY ts DESC LIMIT ? OFFSET ?`)
    .bind(size, (p - 1) * size)
    .all<RawBlocked>();

  return {
    items: (r.results ?? []).map((x) =>
      toItem({ ...x, id: 0, verdict: null, score: null, threshold: null, reasons: null, note: null, model: null, ms: null, detailed: 0 }),
    ),
    total,
    page: p,
    pages,
    pageSize: size,
  };
}

// ——————————————————————————————————————————————————————————
// GET /admin/review/blocked?page=1&pageSize=15
// ——————————————————————————————————————————————————————————
export async function getBlockedLog(request: Request, env: Env, _admin: Admin): Promise<Response> {
  const url = new URL(request.url);
  const rawPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
  // 兼容老前端的 `limit=`（它当时就是「最多几条」，等价于每页条数）
  const rawSize = Number.parseInt(
    url.searchParams.get('pageSize') ?? url.searchParams.get('limit') ?? '10',
    10,
  );
  try {
    const d = await listBlocked(env, Number.isFinite(rawPage) ? rawPage : 1, Number.isFinite(rawSize) ? rawSize : 10);
    return json({ ok: true, ...d });
  } catch (e) {
    return json(
      { ok: false, reason: 'failed', message: e instanceof Error ? e.message : '读取拦截记录失败' },
      500,
    );
  }
}
