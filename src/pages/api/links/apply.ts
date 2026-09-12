// 友链申请的服务端函数(阶段 B / B.1)。
//
// 流程：校验 → Cloudflare Turnstile 防刷 → **限流(Upstash)** → 写私有仓库
//       → Resend 发通知(超额度则排队,下个小时补发)。
//
// 两个端点：
//   GET  /api/links/apply   能力探测。返回 { enabled }，前端据此决定
//                           是「真提交」还是回退到「通道建设中 + 邮件兜底」。
//                           这样在密钥还没配好之前，线上不会出现看不懂的提交失败。
//   POST /api/links/apply   真正提交。
//
// 需要配置的环境变量见仓库根 `.env.example`。
export const prerender = false;

import type { APIRoute } from 'astro';
import { appendApplication } from '../../../lib/applyStore';
import { notifyNewApplication } from '../../../lib/applyNotify';
import { normalizeValues, validateApply, type ApplyValues } from '../../../lib/applyValidation';
import {
  checkAndBump,
  deliverNotifications,
  hashIp,
  rateLimitConfig,
} from '../../../lib/rateLimit';
import { env } from '../../../lib/serverEnv';

// ——— 配置(用户填在 Vercel → Settings → Environment Variables) ———
const APPLY_TOKEN = env('APPLY_TOKEN');
const APPLY_REPO = env('APPLY_REPO') || 'hjphh11/qingwu-link-applications';
const APPLY_PATH = env('APPLY_PATH') || 'applications.json';
const APPLY_REF = env('APPLY_REF') || 'main';

const TURNSTILE_SECRET = env('TURNSTILE_SECRET_KEY');
const TURNSTILE_VERIFY_URL =
  env('TURNSTILE_VERIFY_URL') || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const RESEND_API_KEY = env('RESEND_API_KEY');
const APPLY_MAIL_FROM = env('APPLY_MAIL_FROM');
const APPLY_NOTIFY_TO = env('APPLY_NOTIFY_TO');

// IP 匿名化用的盐(必填才能启用限流;缺了就是 fail-open)
const APPLY_IP_SALT = env('APPLY_IP_SALT');

// 可选覆盖：把对外请求指向本地 mock，用于本地联调(平时不用填)
const GITHUB_API_BASE = env('APPLY_GITHUB_API_BASE') || undefined;
const RESEND_API_BASE = env('RESEND_API_BASE') || undefined;

/** 存储与防刷都就绪才算「能真提交」；限流/邮件是尽力而为，不参与这个判断 */
const ENABLED = Boolean(APPLY_TOKEN && TURNSTILE_SECRET);

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });

/** Turnstile 校验。校验接口本身失败(网络等)时按不通过处理。 */
async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const form = new URLSearchParams();
  form.set('secret', TURNSTILE_SECRET);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export const GET: APIRoute = async () => {
  // rateLimit 只说明「限流有没有配好」,不暴露任何密钥 ——
  // 用来排查「Upstash 变量写错/带引号 → 静默 fail-open」这种情况。
  const rateLimitReady = Boolean(rateLimitConfig() && APPLY_IP_SALT);
  return json({ enabled: ENABLED, rateLimit: rateLimitReady }, 200, {
    'cache-control': 'no-store',
  });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!ENABLED) {
    // 前端会用能力探测提前拦住；真打进来也明确告诉它「现在还不能收」
    return json({ error: 'unavailable', message: '提交通道还没开放' }, 503);
  }

  let payload: (Partial<ApplyValues> & { turnstileToken?: string; hp?: string; elapsedMs?: number }) | null =
    null;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'bad_request', message: '请求格式不对' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return json({ error: 'bad_request', message: '请求格式不对' }, 400);
  }

  // —— 0. 蜜罐：正常访客看不到这个隐藏字段，只有脚本会填 ——
  // 返回「假装成功」，不落库、不发信、不留痕迹，让脚本拿不到反馈。
  if (typeof payload.hp === 'string' && payload.hp.trim() !== '') {
    console.warn('[links/apply] 蜜罐命中，已忽略该提交');
    return json({ ok: true, id: 'ignored', notified: false }, 200, { 'cache-control': 'no-store' });
  }

  // 填表太快通常也不是人(只记日志,不拦 —— 免得误伤自动填充的用户)
  if (typeof payload.elapsedMs === 'number' && payload.elapsedMs >= 0 && payload.elapsedMs < 1500) {
    console.warn(`[links/apply] 填表仅 ${payload.elapsedMs}ms，疑似脚本(未拦截)`);
  }

  // —— 1. 字段校验(与前端同一套规则，前端被绕过也能兜住) ——
  const values = normalizeValues(payload);
  const errors = validateApply(values);
  if (Object.keys(errors).length > 0) {
    return json({ error: 'validation', fields: errors }, 400);
  }

  // —— 2. 人机验证 ——
  const token = typeof payload.turnstileToken === 'string' ? payload.turnstileToken : '';
  if (!token) {
    return json({ error: 'turnstile', message: '请先完成人机验证' }, 403);
  }

  let ip: string | null = null;
  try {
    ip = clientAddress || null;
  } catch {
    ip = null; // 少数运行环境拿不到客户端 IP，不影响主流程
  }

  const passed = await verifyTurnstile(token, ip);
  if (!passed) {
    return json({ error: 'turnstile', message: '人机验证没通过，请刷新后重试' }, 403);
  }

  // —— 3. 限流(只对「真解了人机验证」的提交计数) ——
  const rl = rateLimitConfig();
  if (rl && APPLY_IP_SALT) {
    const decision = await checkAndBump(rl, hashIp(ip || 'unknown', APPLY_IP_SALT));
    if (!decision.allowed) {
      const status = decision.scope?.startsWith('global') ? 503 : 429;
      return json(
        {
          error: 'rate_limited',
          scope: decision.scope,
          message: decision.message,
        },
        status,
        {
          'cache-control': 'no-store',
          ...(decision.retryAfterSec ? { 'retry-after': String(decision.retryAfterSec) } : {}),
        },
      );
    }
  } else if (!rl) {
    console.warn('[links/apply] 未配置 Upstash，限流已跳过(fail-open)');
  } else {
    console.warn('[links/apply] 未配置 APPLY_IP_SALT，限流已跳过(fail-open)');
  }

  // —— 4. 写私有仓库(含去重) ——
  let stored: { ok: true; id: string } | { ok: false; code: 'duplicate'; message: string };
  try {
    stored = await appendApplication(
      {
        token: APPLY_TOKEN,
        repo: APPLY_REPO,
        path: APPLY_PATH,
        ref: APPLY_REF,
        apiBase: GITHUB_API_BASE,
      },
      {
        name: values.name,
        url: values.url,
        avatar: values.avatar,
        intro: values.intro,
        email: values.email,
      },
    );
  } catch (err) {
    // 细节只进服务端日志，不回给访客
    console.error('[links/apply] 写入申请失败:', err);
    return json({ error: 'storage', message: '申请暂时存不进去，请稍后重试或直接邮件联系我' }, 502);
  }

  if (!stored.ok) {
    return json({ error: 'duplicate', message: stored.message }, 409);
  }

  // —— 5. 邮件通知(尽力而为；超额度就排队，下个额度窗口补发) ——
  const submission = {
    id: stored.id,
    submittedAt: new Date().toISOString(),
    ...values,
  };
  let notified = false;
  let queued = false;

  if (RESEND_API_KEY && APPLY_MAIL_FROM && APPLY_NOTIFY_TO) {
    const send = async (p: Record<string, unknown>) => {
      const sent = await notifyNewApplication(
        {
          apiKey: RESEND_API_KEY,
          from: APPLY_MAIL_FROM,
          to: APPLY_NOTIFY_TO,
          apiBase: RESEND_API_BASE,
        },
        p as unknown as Parameters<typeof notifyNewApplication>[1],
      );
      if (!sent.ok) console.error('[links/apply] 邮件通知失败:', sent.error);
      return sent.ok;
    };

    try {
      // 传 null 表示没配 Upstash → 内部会走进程内兜底
      const r = await deliverNotifications(rl, send, submission);
      notified = r.notified;
      queued = r.queued;
    } catch (err) {
      console.error('[links/apply] 通知投递异常，改为直接发送:', err);
      notified = await send(submission);
    }
  } else {
    console.warn('[links/apply] 未配置 Resend，跳过邮件通知');
  }

  return json({ ok: true, id: stored.id, notified, queued }, 200, { 'cache-control': 'no-store' });
};
