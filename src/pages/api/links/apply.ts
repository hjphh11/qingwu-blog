// 友链申请的同源入口 —— **第 2 步迁移后它只是一层转发**。
//
// 真实存储与业务逻辑都在 Cloudflare Worker（`POST/GET/PATCH /apply` → D1）。
// 这个 Vercel 函数只做两件事：
//   1. 给「浏览器直连 Worker 失败」的情况当兜底（跨境抖动、Worker 短暂不可用）；
//   2. 保留一个同源地址，方便排查（`curl https://www.qingwu.ink/api/links/apply`）。
//
// 前端的顺序是「直连优先、失败回退到这里」，所以正常情况下这条路由**不会被调用**。
//
// ⚠️ 已知代价：经这里转发时，Worker 看到的访客 IP 是 Vercel 数据中心 IP 而不是真实
// 访客 IP，限流会变成「所有回退用户共用一个桶」。只在异常路径出现，可以接受；
// 但**不要**把它改回主要入口 —— 那样限流就形同虚设。
//
// 本地联调注意：Worker 侧的人机验证需要访问 challenges.cloudflare.com，
// 而 Windows 上的 workerd 出不去。本地请让 `worker/.dev.vars` 带上
// `DEV_SKIP_TURNSTILE=1`（已 gitignore，线上不会有这个变量）。
export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from '../../../lib/serverEnv';

const WORKER_URL = (env('PUBLIC_HIT_WORKER_URL') || env('HIT_WORKER_URL') || 'https://api.qingwu.ink').replace(/\/$/, '');
/** 转发超时：要和前端那边的 8s 对齐，否则前端先放弃、这边还在写 */
const FORWARD_TIMEOUT_MS = 9000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * 转给 Worker，返回**上游的状态码与响应体文本**（不返回 Response 对象）。
 *
 * 返回 `{status, text}` 而不是 `Response`，是为了让失败重试和「就地构造 Response」
 * 都发生在同一个函数里 —— 曾经把 fetch 得到的 Response 直接往上抛，
 * 在 astro dev 下很难判断 500 到底来自上游还是本地兜底。现在边界清楚。
 */
type Forwarded = { status: number; text: string; contentType: string } | null;

async function forward(request: Request, path: string, method: string, body?: string): Promise<Forwarded> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(body ? { 'content-type': 'application/json' } : {}),
    // **不复用连接**。Node 的 undici 默认 keep-alive 复用，而 workerd（wrangler dev）
    // 在复用连接上处理 POST 会间歇性回一个裸 500（body 就是 `Internal Server Error`、
    // 无 content-type、Worker 自己的日志里查不到这条记录）。
    // 实测症状：直连 Worker 永远正常，经这条转发则「一次好一次坏」。
    // 代价是多一次握手；但这条路由本来只在「浏览器直连 Worker 失败」时才走，可以接受。
    connection: 'close',
  };
  const ua = request.headers.get('user-agent');
  if (ua) headers['user-agent'] = ua;
  // 注意：**不要转发 x-forwarded-for / x-real-ip**。
  // 经 Vercel 转发时带着它们会让远端看到 Vercel 机房 IP 冒充的访客 IP，
  // 反而污染限流统计；Worker 侧本来就用 cf-connecting-ip。
  // （经 Vercel 转发拿不到真实访客 IP 这件事是已知代价，见文件头。）

  // 裸 5xx 重试一次：跨境链路 + Worker 冷启动都会偶发，访客不该看到这种失败。
  // 只重试 5xx，**不重试 4xx** —— 4xx 是业务答复（重复提交 / 被限流），重试没意义。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${WORKER_URL}${path}`, {
        method,
        headers,
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });

      // 原样透传状态码与响应体：访客需要看到「重复提交」「被限流」这些准确答复
      const text = await res.text();
      if (res.status >= 500 && attempt === 0) {
        console.warn(`[links/apply] Worker 返回 ${res.status}，重试一次`);
        continue;
      }
      return {
        status: res.status,
        text,
        contentType: res.headers.get('content-type') || 'application/json; charset=utf-8',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        console.warn('[links/apply] 转发 Worker 失败，重试一次:', msg);
        continue;
      }
      console.error('[links/apply] 转发 Worker 失败:', msg);
      return null;
    }
  }
  return null;
}

/** 把 Worker 的答复原样回给访客 */
const relay = (f: { status: number; text: string; contentType: string }): Response =>
  new Response(f.text, {
    status: f.status,
    headers: { 'content-type': f.contentType, 'cache-control': 'no-store' },
  });

/** 能力探测（无口令）：只回答「能不能提交」 */
export const GET: APIRoute = async () => {
  const f = await forward(new Request('https://placeholder/'), '/apply', 'GET');
  if (f) return relay(f);
  // Worker 不可达时也别说「能收」—— 前端据此决定要不要显示表单
  return json({ enabled: false, reason: 'worker_unreachable' });
};

export const POST: APIRoute = async ({ request }) => {
  // 读出原始 body 再转发（不能直接传 request.body 流：转发失败时可能已被消费）
  let body: string;
  try {
    body = await request.text();
  } catch {
    return json({ error: 'bad_request', message: '请求格式不对' }, 400);
  }

  const f = await forward(request, '/apply', 'POST', body);
  if (f) return relay(f);
  return json({ error: 'storage', message: '申请暂时存不进去，请稍后重试或直接邮件联系我' }, 502);
};
