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
 * 最近的拦截记录。
 *
 * 两段查询合并：
 *   ① moderation_log 里有判定详情的；
 *   ② comments 里 status='spam' 但日志表没对应行的（功能上线前的历史）。
 * 按时间倒序取前 limit 条。
 */
export async function listBlocked(env: Env, limit = 20): Promise<BlockedItem[]> {
  const n = Math.max(1, Math.min(200, limit));
  const out: BlockedItem[] = [];

  try {
    const r = await env.DB.prepare(
      `SELECT m.id, m.comment_id, m.verdict, m.score, m.threshold, m.reasons, m.note,
              m.model, m.ms, m.ts,
              c.author, c.body, c.post_slug, c.status AS cstatus
         FROM moderation_log m
         LEFT JOIN comments c ON c.id = m.comment_id
        ORDER BY m.ts DESC LIMIT ?`,
    )
      .bind(n)
      .all<{
        id: number;
        comment_id: number;
        verdict: string;
        score: number;
        threshold: number;
        reasons: string | null;
        note: string | null;
        model: string | null;
        ms: number | null;
        ts: number;
        author: string | null;
        body: string | null;
        post_slug: string | null;
        cstatus: string | null;
      }>();

    for (const x of r.results ?? []) {
      out.push({
        id: x.id,
        commentId: x.comment_id,
        verdict: x.verdict,
        score: x.score,
        threshold: x.threshold,
        reasons: reasonsOf(x.reasons),
        note: x.note ?? '',
        model: x.model ?? '',
        ms: x.ms,
        ts: x.ts,
        author: x.author ?? '（留言已删）',
        body: String(x.body ?? '').slice(0, 120),
        path: x.post_slug ? pathOfSlug(x.post_slug) : '',
        status: x.cstatus ?? 'spam',
        detailed: true,
      });
    }
  } catch {
    /* 表还没迁移：走下面的补齐查询，页面不至于整块空 */
  }

  try {
    const r2 = await env.DB.prepare(
      `SELECT c.id, c.author, c.body, c.post_slug, c.status, c.ts
         FROM comments c
        WHERE c.status = 'spam'
          AND NOT EXISTS (SELECT 1 FROM moderation_log m WHERE m.comment_id = c.id)
        ORDER BY c.ts DESC LIMIT ?`,
    )
      .bind(n)
      .all<{
        id: number;
        author: string;
        body: string;
        post_slug: string;
        status: string;
        ts: number;
      }>();

    for (const x of r2.results ?? []) {
      out.push({
        id: 0,
        commentId: x.id,
        verdict: null,
        score: null,
        threshold: null,
        reasons: [],
        note: '',
        model: '',
        ms: null,
        ts: x.ts,
        author: x.author,
        body: String(x.body ?? '').slice(0, 120),
        path: pathOfSlug(x.post_slug),
        status: x.status,
        detailed: false,
      });
    }
  } catch {
    /* comments 表都读不到就没救了，返回已有的 */
  }

  return out.sort((a, b) => b.ts - a.ts).slice(0, n);
}

// ——————————————————————————————————————————————————————————
// GET /admin/review/blocked?limit=20
// ——————————————————————————————————————————————————————————
export async function getBlockedLog(request: Request, env: Env, _admin: Admin): Promise<Response> {
  const raw = Number(new URL(request.url).searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(raw) ? raw : 20;
  try {
    const items = await listBlocked(env, limit);
    return json({ ok: true, items, count: items.length });
  } catch (e) {
    return json(
      { ok: false, reason: 'failed', message: e instanceof Error ? e.message : '读取拦截记录失败' },
      500,
    );
  }
}
