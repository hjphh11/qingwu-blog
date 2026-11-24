// 清吾 · GET /site-summary —— 全站访问汇总（公开只读、无口令）
//
//   → { ok: true, pv: 12345, uv: 678, updatedAt: '2026-11-24T08:00:00.000Z' }
//
// 用途只有一个：首页右栏「悄悄收藏的脚印」要显示**全站真值**，而不是
// 当前这台浏览器 localStorage 里累加出来的那个数（那个数谁看都是 1 位旅人）。
//
// 口径与 /stats、/post-views 完全一致，不另造一套：
//   · PV = hits 明细行数 + daily_stats 的历史汇总（两张表日期不重叠，可相加）
//   · UV = hits 里 COUNT(DISTINCT visitor)；**历史补不了 UV** ——
//     daily_stats 是从旧 stats.json 迁来的，只留了每天的 PV 分布，没有访客维度
//     （见 worker/src/views.ts 顶部说明）。所以 uv 是「迁移之后来过多少人」。
//
// 三条刻意的边界：
//   1. **只回两个整数**，不带路径 / 国家 / 设备 / 引用来源。汇总数据给出去没问题，
//      明细是另一回事 —— 那是后台才看的东西。
//   2. **永远 200**（失败也回 200 + ok:false）。首页不该为一个装饰性数字变成
//      「卡片报错」；前端拿不到就退回 localStorage。
//   3. **缓存 60 秒**。这个数按分钟级变化就够，没必要每个访客都读一次 D1。
//      首页是流量最大的页面，这条缓存挡掉的是绝大多数读。
import type { Env } from './types';
import { json, originAllowed, parseOrigins } from './util';

/** 浏览器 / 边缘缓存秒数 */
const CACHE_SECONDS = 60;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export async function getSiteSummary(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('origin') || '';
  const headers: Record<string, string> = {
    'cache-control': `public, max-age=${CACHE_SECONDS}`,
  };
  // 正常走同源 /api/site-summary（nginx 去前缀转发），用不到 CORS；
  // 与 /post-views 一样留着，方便哪天浏览器直连 Worker。
  if (origin && originAllowed(origin, parseOrigins(env.ALLOWED_ORIGINS))) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'origin';
  }

  try {
    const row = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM hits) AS hit_pv,
         (SELECT COUNT(DISTINCT visitor) FROM hits) AS hit_uv,
         (SELECT COALESCE(SUM(pv), 0) FROM daily_stats) AS old_pv`,
    ).first<{ hit_pv: number; hit_uv: number; old_pv: number }>();

    return json(
      {
        ok: true,
        pv: num(row?.hit_pv) + num(row?.old_pv),
        uv: num(row?.hit_uv),
        updatedAt: new Date().toISOString(),
      },
      200,
      headers,
    );
  } catch (err) {
    // 表还没迁完 / 库暂时读不到：只记日志，前端会退回本地计数
    console.error('[site-summary] 读取失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'error' }, 200, headers);
  }
}
