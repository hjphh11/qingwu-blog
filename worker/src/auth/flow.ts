import type { Env } from '../types';
import { json } from '../util';
import { cookieOf, corsHeaders, ipHash, SESSION_COOKIE, SESSION_TTL_SEC } from './common';
import { claimComments, publicAccount } from './account';
import { createSession, findAccountById, touchAccount } from './store';
import { claimLikes, visitorKey } from '../visitor';
import { sendLoginCode, verifyLoginCode } from './codes';

import { fail } from './error';
export { AuthError, fail } from './error';
export const stringField = (value: unknown) => (typeof value === 'string' ? value : '');

export async function takeAttempt(
  env: Env,
  request: Request,
  scope: string,
  limit: number,
  window: number,
) {
  const key = scope + ':' + (await ipHash(request, env));
  const now = Date.now();
  await env.DB.prepare('DELETE FROM auth_attempts WHERE ts < ?')
    .bind(now - 86400000)
    .run();
  const result = await env.DB.prepare(
    `INSERT INTO auth_attempts(ip_hash,ts,ok) SELECT ?,?,0
    WHERE (SELECT count(*) FROM auth_attempts WHERE ip_hash=? AND ts>?) < ?`,
  )
    .bind(key, now, key, now - window, limit)
    .run();
  if (!result.meta.changes) fail(429, 'limited', '尝试次数过多，请稍后再试');
  return { id: result.meta.last_row_id };
}

export async function sendCode(env: Env, request: Request, email: string, purpose: string) {
  const result = await sendLoginCode(env, request, email, purpose);
  return json(
    result.ok ? { ...result, cooldown: 60 } : result,
    result.ok ? 200 : ['cooldown', 'limited', 'locked'].includes(result.reason) ? 429 : 400,
    corsHeaders(request, env),
  );
}
export async function checkCode(
  env: Env,
  request: Request,
  email: string,
  code: unknown,
  purpose: string,
) {
  const r = await verifyLoginCode(env, request, email, code, purpose);
  if (!r.ok)
    fail(
      r.reason === 'locked' ? 429 : 400,
      r.reason === 'expired' ? 'code_expired' : r.reason,
      r.message,
    );
}

export async function signedIn(env: Env, request: Request, id: number, hash: string, email: string) {
  const account = await findAccountById(env, id);
  if (!account || account.status !== 'active') fail(403, 'disabled', '账号暂不可用，请联系站长');
  const token = await createSession(env, request, id, 'visitor', { hash, email });
  await Promise.all([
    touchAccount(env, id),
    claimComments(env, account),
    claimLikes(env, await visitorKey(request, env), id),
  ]);
  return json(
    { ok: true, account: await publicAccount(env, account), suggestSetPassword: !account.has_password },
    200,
    corsHeaders(request, env, {
      'set-cookie': cookieOf(request, SESSION_COOKIE, token, SESSION_TTL_SEC),
    }),
  );
}
