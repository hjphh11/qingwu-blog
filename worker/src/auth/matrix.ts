import type { Env } from '../types';
import { hexOf } from './common';
import { usernameError } from './rules';
import type { AccountRow } from './store';

/** Only the site's own homeserver may receive account credentials. */
export async function syncMatrix(env: Env, account: AccountRow, password: string, expectedHash: string) {
  if (
    account.username_provisional ||
    !account.username ||
    usernameError(account.username) ||
    account.role === 'admin'
  )
    return;
  const row = await env.DB.prepare(
    'SELECT matrix_hs, matrix_name_synced_at, pass_hash FROM accounts WHERE id=?',
  )
    .bind(account.id)
    .first<{ matrix_hs: string | null; matrix_name_synced_at: number | null; pass_hash: string }>();
  if (!row || row.pass_hash !== expectedHash || account.matrix_status === 'disabled') return;
  const base = env.ACCOUNT_MATRIX_HS?.replace(/\/$/, '');
  let status = 'pending';
  try {
    if (base && new URL(base).protocol === 'https:' && env.ACCOUNT_MATRIX_SECRET) {
      const userId = '@' + account.username + ':' + new URL(base).host;
      const signal = AbortSignal.timeout(5000);
      const options = { signal, redirect: 'error' as const };
      if (account.matrix_user_id) {
        if (
          row.matrix_hs !== base ||
          account.matrix_user_id !== userId ||
          (row.matrix_name_synced_at && account.matrix_pw_synced_at) ||
          !env.ACCOUNT_MATRIX_ADMIN_TOKEN
        )
          return;
        const update = await fetch(base + '/_synapse/admin/v2/users/' + encodeURIComponent(userId), {
          ...options,
          method: 'PUT',
          headers: {
            authorization: 'Bearer ' + env.ACCOUNT_MATRIX_ADMIN_TOKEN,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            displayname: account.display_name,
            password: account.matrix_pw_synced_at ? undefined : password,
          }),
        });
        if (!update.ok) return;
      } else {
        const endpoint = base + '/_synapse/admin/v1/register';
        const challenge = await fetch(endpoint, options);
        if (!challenge.ok) throw Error('nonce');
        const { nonce } = await challenge.json<{ nonce: string }>();
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          enc.encode(env.ACCOUNT_MATRIX_SECRET),
          { name: 'HMAC', hash: 'SHA-1' },
          false,
          ['sign'],
        );
        const mac = hexOf(
          await crypto.subtle.sign(
            'HMAC',
            key,
            enc.encode([nonce, account.username, password, 'notadmin'].join('\0')),
          ),
        );
        const result = await fetch(endpoint, {
          ...options,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nonce,
            mac,
            username: account.username,
            password,
            displayname: account.display_name,
            admin: false,
            inhibit_login: true,
          }),
        });
        const reply = await result.json<{ user_id?: string; errcode?: string }>();
        if (reply.errcode === 'M_USER_IN_USE') {
          // A lost success response is retryable, but an unrelated Matrix user must never be adopted.
          const proof = await fetch(base + '/_matrix/client/v3/login', {
            ...options,
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'm.login.password',
              identifier: { type: 'm.id.user', user: userId },
              password,
            }),
          });
          const session = await proof.json<{ user_id?: string; access_token?: string }>();
          if (!proof.ok || session.user_id !== userId || !session.access_token) {
            status = proof.status === 403 ? 'failed' : 'pending';
            throw Error('ownership');
          }
          await fetch(base + '/_matrix/client/v3/logout', {
            ...options,
            method: 'POST',
            headers: { authorization: 'Bearer ' + session.access_token },
          });
        } else if (!result.ok || reply.user_id !== userId) {
          if (result.status === 400) status = 'failed';
          throw Error('register');
        }
      }
      const now = Date.now();
      await env.DB.prepare(
        `UPDATE accounts SET matrix_status='active', matrix_user_id=?, matrix_hs=?,
        matrix_created_at=coalesce(matrix_created_at,?), matrix_pw_synced_at=CASE WHEN pass_hash=? THEN ? END,
        matrix_name_synced_at=CASE WHEN display_name IS ? THEN ? END WHERE id=?`,
      )
        .bind(userId, base, now, row.pass_hash, now, account.display_name, now, account.id)
        .run();
      return;
    }
  } catch {
    /* Local registration succeeds even when the homeserver is unavailable. */
  }
  await env.DB.prepare('UPDATE accounts SET matrix_status=? WHERE id=? AND matrix_user_id IS NULL')
    .bind(status, account.id)
    .run();
}

/** Sync one changed display name per scheduled run. No user password is retained. */
export async function syncMatrixName(env: Env) {
  const base = env.ACCOUNT_MATRIX_HS?.replace(/\/$/, '');
  if (!base || !base.startsWith('https://') || !env.ACCOUNT_MATRIX_ADMIN_TOKEN) return;
  const row = await env.DB.prepare(
    `SELECT id, matrix_user_id, display_name FROM accounts
    WHERE matrix_status='active' AND matrix_hs=? AND matrix_name_synced_at IS NULL AND status='active' LIMIT 1`,
  )
    .bind(base)
    .first<{ id: number; matrix_user_id: string; display_name: string }>();
  if (!row) return;
  const res = await fetch(base + '/_synapse/admin/v2/users/' + encodeURIComponent(row.matrix_user_id), {
    method: 'PUT',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: {
      authorization: 'Bearer ' + env.ACCOUNT_MATRIX_ADMIN_TOKEN,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ displayname: row.display_name }),
  });
  if (res.ok)
    await env.DB.prepare('UPDATE accounts SET matrix_name_synced_at=? WHERE id=? AND display_name IS ?')
      .bind(Date.now(), row.id, row.display_name)
      .run();
}
