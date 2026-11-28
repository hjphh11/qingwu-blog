import type { Env } from '../types';
import { json, originAllowed, parseOrigins } from '../util';
import { siteUrl } from '../auth/common';

/** Queue each migration notice once, using the normal mail worker. */
export async function queueAccountNotices(request: Request, env: Env) {
  if (
    !originAllowed(request.headers.get('origin'), [
      new URL(request.url).origin,
      siteUrl(env),
      ...parseOrigins(env.ALLOWED_ORIGINS).filter((o) => o !== '*'),
    ])
  ) {
    return json({ ok: false, reason: 'origin' }, 403);
  }
  if (!env.RESEND_KEY) return json({ ok: false, message: '请先配置发信通道' }, 503);
  const pending = "username_provisional=1 AND status='active' AND migration_notice_at IS NULL";
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const [queued] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mail_outbox(created_at,next_try_at,tries,payload)
      SELECT ?,?,0,json_object('to',email,'subject','来确认一下你在清吾的用户名',
        'text','你好，清吾升级了账号体系。你的临时用户名是 ' || username ||
        '。这个名字以后会成为你的 Matrix 账号名。请到 ' || ? ||
        '/account/ 用邮箱验证码登录，确认或更换一次。确认后就定下来了。') FROM accounts WHERE ${pending}`,
    ).bind(seconds, seconds, siteUrl(env)),
    env.DB.prepare(`UPDATE accounts SET migration_notice_at=? WHERE ${pending}`).bind(now),
  ]);
  return json({ ok: true, queued: queued.meta.changes });
}
