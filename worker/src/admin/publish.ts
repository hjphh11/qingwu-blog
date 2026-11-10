// 清吾 · 友链发布记录
//
// 后台每次把 links.json 推到仓库（或降级成「复制粘贴」、或失败）都留一条。
// 之前提交完只有一句 toast，过两天想不起改过哪条，只能翻 git log ——
// 而 git log 里看不到「字段从什么变成了什么」。
//
// 记录里的 `changes` 由前端算好传上来：**只有前端同时握着「原始 links.json」
// 和「当前草稿」**，后端再去算一遍等于把 diff 逻辑写两遍。
// 后端只负责落库与校验形状，不猜。

import type { Env } from '../types';
import type { Admin } from './auth';

export interface FieldChange {
  /** 友链名（改动后）。删除时用旧名。 */
  name: string;
  /** name / url / avatar / intro / shot / visible / addedAt / 或 `+`（新增）/ `-`（删除） */
  field: string;
  from: string;
  to: string;
}

export type PublishStatus = 'ok' | 'manual' | 'failed';

const FIELD_LABEL: Record<string, string> = {
  name: '名称',
  url: '网址',
  avatar: '头像',
  intro: '描述',
  shot: '主页图',
  visible: '展示',
  addedAt: '收录日期',
  '+': '新增',
  '-': '删除',
};

/** 字段名 → 中文。认不出来的原样返回，总比显示一个英文字段名强。 */
export function fieldLabel(f: string): string {
  return FIELD_LABEL[f] ?? f;
}

/** 一条记录的形状。前端直接渲染，不再加工。 */
export interface PublishEntry {
  id: number;
  ts: number;
  by: string;
  commit: string;
  message: string;
  changes: FieldChange[];
  status: PublishStatus;
  detail: string;
}

function cleanChanges(raw: unknown): FieldChange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 200)
    .map((c) => {
      const o = c as Record<string, unknown>;
      return {
        name: String(o.name ?? '').slice(0, 60),
        field: String(o.field ?? '').slice(0, 20),
        from: String(o.from ?? '').slice(0, 160),
        to: String(o.to ?? '').slice(0, 160),
      };
    })
    .filter((c) => c.name || c.field);
}

/**
 * 写一条发布记录。**失败不抛** —— 记录是附加信息，
 * 不能因为它把「已经提交成功的友链」报成失败。
 */
export async function logPublish(
  env: Env,
  admin: Admin | null,
  rec: {
    status: PublishStatus;
    changes: unknown;
    message?: string;
    commit?: string;
    detail?: string;
    baseSha?: string;
  },
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO friend_publish_log (ts, by_name, commit_sha, message, changes, status, detail, base_sha)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        Date.now(),
        admin?.username ?? null,
        rec.commit ? rec.commit.slice(0, 80) : null,
        rec.message ? rec.message.slice(0, 200) : null,
        JSON.stringify(cleanChanges(rec.changes)),
        rec.status,
        rec.detail ? rec.detail.slice(0, 400) : null,
        rec.baseSha ? rec.baseSha.slice(0, 80) : null,
      )
      .run();
  } catch (e) {
    // 迁移没跑 / 表被删 → 只丢记录，不影响提交结果
    console.warn('[admin] friend_publish_log 写入失败：', e instanceof Error ? e.message : e);
  }
}

/** 最近 N 条。表不存在时返回空数组（老部署不跑迁移也能打开友链页）。 */
export async function listPublishLog(env: Env, limit = 20): Promise<PublishEntry[]> {
  const n = Math.max(1, Math.min(50, Math.floor(limit) || 20));
  try {
    const r = await env.DB.prepare(
      `SELECT id, ts, by_name, commit_sha, message, changes, status, detail
         FROM friend_publish_log ORDER BY ts DESC, id DESC LIMIT ?`,
    )
      .bind(n)
      .all<{
        id: number;
        ts: number;
        by_name: string | null;
        commit_sha: string | null;
        message: string | null;
        changes: string;
        status: string;
        detail: string | null;
      }>();

    return (r.results ?? []).map((row) => {
      let changes: FieldChange[] = [];
      try {
        changes = cleanChanges(JSON.parse(row.changes || '[]'));
      } catch {
        /* 坏行当空的，别让一条脏数据把整页打挂 */
      }
      const status: PublishStatus =
        row.status === 'ok' || row.status === 'manual' || row.status === 'failed' ? row.status : 'failed';
      return {
        id: row.id,
        ts: row.ts,
        by: row.by_name ?? '',
        commit: row.commit_sha ?? '',
        message: row.message ?? '',
        changes,
        status,
        detail: row.detail ?? '',
      };
    });
  } catch {
    return [];
  }
}

/** GET /admin/friends/publish-log —— 单独取（友链页刷新时不必整份重拉） */
export async function getPublishLog(request: Request, env: Env, _admin: Admin): Promise<Response> {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20;
  const items = await listPublishLog(env, limit);
  return Response.json({ ok: true, items });
}
