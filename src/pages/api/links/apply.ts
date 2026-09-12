// 友链申请的服务端函数(阶段 B)。
//
// 流程：校验 → Cloudflare Turnstile 防刷 → 写私有仓库 → Resend 发通知给站主。
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

// 可选覆盖：把对外请求指向本地 mock，用于本地联调(平时不用填)
const GITHUB_API_BASE = env('APPLY_GITHUB_API_BASE') || undefined;
const RESEND_API_BASE = env('RESEND_API_BASE') || undefined;

/** 存储与防刷都就绪才算「能真提交」；邮件是尽力而为，不参与这个判断 */
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
  return json({ enabled: ENABLED }, 200, { 'cache-control': 'no-store' });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!ENABLED) {
    // 前端会用能力探测提前拦住；真打进来也明确告诉它「现在还不能收」
    return json({ error: 'unavailable', message: '提交通道还没开放' }, 503);
  }

  let payload: (Partial<ApplyValues> & { turnstileToken?: string }) | null = null;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'bad_request', message: '请求格式不对' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return json({ error: 'bad_request', message: '请求格式不对' }, 400);
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

  // —— 3. 写私有仓库(含去重) ——
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

  // —— 4. 邮件通知(尽力而为：失败不影响访客，数据已经存好了) ——
  let notified = false;
  if (RESEND_API_KEY && APPLY_MAIL_FROM && APPLY_NOTIFY_TO) {
    const sent = await notifyNewApplication(
      {
        apiKey: RESEND_API_KEY,
        from: APPLY_MAIL_FROM,
        to: APPLY_NOTIFY_TO,
        apiBase: RESEND_API_BASE,
      },
      {
        id: stored.id,
        submittedAt: new Date().toISOString(),
        ...values,
      },
    );
    notified = sent.ok;
    if (!sent.ok) console.error('[links/apply] 邮件通知失败:', sent.error);
  } else {
    console.warn('[links/apply] 未配置 Resend，跳过邮件通知');
  }

  return json({ ok: true, id: stored.id, notified }, 200, { 'cache-control': 'no-store' });
};
