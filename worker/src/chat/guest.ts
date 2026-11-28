import type { Env } from '../types';
import { json, originAllowed, parseOrigins } from '../util';
import { avatarFromHash } from '../auth/avatar';
import {
  cookieOf,
  corsHeaders,
  ipHash,
  isEmail,
  normalizeEmail,
  randomToken,
  readCookie,
  sha256Hex,
} from '../auth/common';
import { AuthError, takeAttempt } from '../auth/flow';
import { emailHashOf } from '../auth/md5';
import { validNickname } from '../auth/rules';
import { CHAT_GUEST_COOKIE, chatSessionUser } from '../auth/store';

const TTL_SECONDS = 7 * 86400;

export async function guestSession(request: Request, env: Env) {
  const headers = corsHeaders(request, env);
  const allowed = parseOrigins(env.ALLOWED_ORIGINS).filter((origin) => origin !== '*');
  allowed.push(new URL(request.url).origin);
  if (env.SITE_URL) allowed.push(env.SITE_URL);
  if (!originAllowed(request.headers.get('origin'), allowed))
    return json({ ok: false, reason: 'origin' }, 403);
  if (request.method === 'DELETE') {
    const token = readCookie(request, CHAT_GUEST_COOKIE);
    if (token)
      await env.DB.prepare("DELETE FROM auth_sessions WHERE kind='chat_guest' AND token_hash=?")
        .bind(await sha256Hex(token))
        .run();
    return json({ ok: true }, 200, {
      ...headers,
      'set-cookie': cookieOf(request, CHAT_GUEST_COOKIE, '', 0),
    });
  }

  const current = await chatSessionUser(request, env);
  if (current) return json({ ok: true }, 200, headers);

  const body = await request.json<{ name?: unknown; email?: unknown }>().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
  if (!validNickname(name))
    return json({ ok: false, message: '名字需为 1–20 个字，最多 3 个 emoji。' }, 400, headers);
  if (!isEmail(email)) return json({ ok: false, message: '请输入有效的邮箱地址。' }, 400, headers);
  try {
    await takeAttempt(env, request, 'chat-guest', 5, 3600000);
  } catch (e) {
    if (e instanceof AuthError) return json({ ok: false, message: e.message }, e.status, headers);
    throw e;
  }

  // Chat foreign keys use accounts.id. Give every new guest an unaddressable,
  // random anchor. An unverified mailbox is only an avatar seed, never a lookup key.
  const anchor = 'chat-guest:' + randomToken(24);
  const emailHash = emailHashOf(email);
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO accounts(email,email_hash,avatar_url,display_name,role,matrix_status,created_at,last_seen_at)
      VALUES(?,?,?,?,'chat_guest','disabled',?,?)`,
    ).bind(anchor, emailHash, avatarFromHash(emailHash), name + '（访客）', now, now),
    env.DB.prepare(
      `INSERT INTO auth_sessions(token_hash,account_id,kind,created_at,expires_at,ip_hash,ua)
      SELECT ?,id,'chat_guest',?,?,?,? FROM accounts WHERE email=? AND role='chat_guest'`,
    ).bind(
      await sha256Hex(token),
      now,
      now + TTL_SECONDS * 1000,
      await ipHash(request, env),
      (request.headers.get('user-agent') || '').slice(0, 200),
      anchor,
    ),
    env.DB.prepare("DELETE FROM auth_sessions WHERE kind='chat_guest' AND expires_at<=?").bind(now),
  ]);
  return json({ ok: true }, 200, {
    ...headers,
    'set-cookie': cookieOf(request, CHAT_GUEST_COOKIE, token, TTL_SECONDS),
  });
}
