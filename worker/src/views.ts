// 清吾 · GET /post-views —— 单篇文章的阅读量
//
//   GET /post-views?path=/blog/some-post
//   → { ok: true, pv: 123, uv: 45 }
//
// 口径与 /stats 一致，不另造一套：
//   · `hits`（迁移后逐条明细）→ COUNT(*) 就是 PV，COUNT(DISTINCT visitor) 是 UV
//   · `daily_stats`（迁移自旧 stats.json 的历史汇总）只留了「每天的 pages 分布 JSON」，
//     没有 visitor 维度 —— 所以历史只能补 PV，UV 只统计迁移之后的部分。
//
// ⚠️ 两个刻意的取舍：
//   1. **只服务 /blog/ 开头的路径**。这个端点是公开可读的，不设边界就等于送了一个
//      「任意 path 的统计查询器」给别人扫。
//   2. **永远 200**。数字拿不到就让前端把那块藏起来，别为一个装饰性的数字把文章页打挂。
//
// 缓存 120s：PV 不需要秒级新鲜，但能省掉绝大部分 D1 读。

import type { Env } from './types';
import { json, normPath, originAllowed, parseOrigins } from './util';

/** 浏览器 / 边缘缓存秒数 */
const CACHE_SECONDS = 120;

function resHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  const headers: Record<string, string> = {
    'cache-control': `public, max-age=${CACHE_SECONDS}`,
  };
  // 站点直连时（局域网版 / 显式跨域）才需要 CORS 头
  if (origin && originAllowed(origin, parseOrigins(env.ALLOWED_ORIGINS))) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'origin';
  }
  return headers;
}

/** 从 daily_stats 的一行 pages JSON 里取出该 path 的历史 PV */
function legacyPvOf(raw: string | null, path: string): number {
  if (!raw) return 0;
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return 0;
    let sum = 0;
    for (const it of arr) {
      const p = (it as { p?: unknown })?.p;
      const pv = Number((it as { pv?: unknown })?.pv ?? 0);
      // LIKE 只做粗筛，这里必须精确比对，否则 /blog/foo 会把 /blog/foo-bar 也吃进来
      if (p === path && Number.isFinite(pv) && pv > 0) sum += pv;
    }
    return sum;
  } catch {
    return 0;
  }
}

export async function getPostViews(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = normPath(url.searchParams.get('path'));
  const headers = resHeaders(request, env);

  if (!path.startsWith('/blog/')) return json({ ok: true, pv: 0, uv: 0 }, 200, headers);

  try {
    // ⚠️ `COUNT(DISTINCT visitor)` 会把 NULL 直接忽略 —— 早期写入的少数行 visitor 是空的，
    //    结果 pv=2 / uv=0 这种自相矛盾的数就出来了。没法识别访客的记录就各自算一个，
    //    宁可 UV 偏大也不能让「有 2 次阅读、0 位访客」出现在页面上。
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS pv,
              COUNT(DISTINCT COALESCE(NULLIF(visitor, ''), 'row:' || id)) AS uv
         FROM hits WHERE path = ?1`,
    )
      .bind(path)
      .first<{ pv: number; uv: number }>();

    const uv = Number(row?.uv ?? 0);
    let pv = Number(row?.pv ?? 0);

    // 历史汇总：JSON 里含该路径才有可能命中，先用它筛掉绝大多数字行
    const legacy = await env.DB.prepare('SELECT pages FROM daily_stats WHERE pages LIKE ?1')
      .bind(`%${path}%`)
      .all<{ pages: string | null }>();
    for (const r of legacy.results ?? []) pv += legacyPvOf(r.pages, path);

    return json({ ok: true, pv, uv }, 200, headers);
  } catch (err) {
    console.error('[worker] /post-views 查询失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'error', pv: 0, uv: 0 }, 200, headers);
  }
}
