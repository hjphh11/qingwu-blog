import type { Env } from '../types';
import { json, secretEqual } from '../util';
import { checkPassword, checkUsername } from './register';
import {
  corsHeaders,
  ipHash,
  isEmail,
  normalizeEmail,
  randomToken,
  readCookie,
  SESSION_COOKIE,
  sha256Hex,
} from './common';
import { checkCode, fail, sendCode, signedIn, stringField, takeAttempt } from './flow';
import { publicAccount } from './account';
import { findAccountById, identityOwner, sessionUser } from './store';
import { PBKDF2_ITER, pbkdf2 } from './password';
import { emailHashOf } from './md5';
import { syncMatrix } from './matrix';

type Credentials = {
  id: number;
  email: string;
  username: string;
  status: string;
  role: string;
  pass_hash: string | null;
  salt: string;
  iterations: number;
  locked_until: number | null;
};
async function matches(password: string, row: Credentials | null) {
  const hash = await pbkdf2(
    password,
    row?.salt || 'decoy-salt-for-timing',
    row?.iterations || PBKDF2_ITER,
  );
  return secretEqual(hash, row?.pass_hash || '0'.repeat(64));
}

export async function passwordLogin(env: Env, request: Request, body: Record<string, unknown>) {
  const identifier = stringField(body.identifier).trim().toLowerCase();
  const attempt = await takeAttempt(env, request, 'password', 10, 600000);
  const column = identifier.includes('@') ? 'email' : 'username';
  const row = await env.DB.prepare(`SELECT * FROM accounts WHERE ${column}=? AND role='visitor'`)
    .bind(identifier)
    .first<Credentials>();
  if (row && row.status !== 'active') fail(403, 'disabled', '账号已停用，请联系站长');
  if (row && (row.locked_until ?? 0) > Date.now())
    fail(429, 'locked', '密码尝试过多，请稍后再试或使用邮箱验证码');
  if (row && !row.pass_hash) {
    await env.DB.prepare('DELETE FROM auth_attempts WHERE id=?').bind(attempt.id).run();
    fail(409, 'no_password', '还没设密码，请用邮箱验证码登录后设置');
  }
  const password = stringField(body.password).trim();
  const match = await matches(password, row);
  if (!row || !match) {
    if (row)
      await env.DB.prepare(
        `UPDATE accounts SET
      failed_logins=CASE WHEN locked_until IS NOT NULL THEN 1 ELSE failed_logins+1 END,
      locked_until=CASE WHEN locked_until IS NULL AND failed_logins>=7 THEN ? END
      WHERE id=? AND (locked_until IS NULL OR locked_until<=?)`,
      )
        .bind(Date.now() + 900000, row.id, Date.now())
        .run();
    fail(401, 'bad_credentials', '账号或密码不对');
  }
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE accounts SET failed_logins=0, locked_until=NULL WHERE id=? AND pass_hash=? AND status='active'",
    ).bind(row.id, row.pass_hash),
    env.DB.prepare('DELETE FROM auth_attempts WHERE id=?').bind(attempt.id),
  ]);
  if (!updated.meta.changes) fail(401, 'bad_credentials', '请重新登录');
  const account = await findAccountById(env, row.id);
  if (!account) fail(401, 'bad_credentials', '请重新登录');
  await syncMatrix(env, account, password, row.pass_hash!);
  return signedIn(env, request, row.id, row.pass_hash!, row.email);
}

export async function security(env: Env, request: Request, path: string, body: Record<string, unknown>) {
  const me = await sessionUser(request, env);
  if (!me) fail(401, 'unauthorized', '请先登录');
  let account = me.account;
  const headers = corsHeaders(request, env);
  if (path === '/auth/username/confirm') {
    if (body.account_id !== undefined) {
      if (me.kind !== 'admin' || me.account.role !== 'admin') fail(403, 'forbidden', '需要后台会话');
      const target = await findAccountById(env, Number(body.account_id));
      if (!target) fail(404, 'not_found', '找不到账号');
      account = target;
    }
    if (account.matrix_user_id || account.matrix_status === 'active')
      fail(403, 'matrix_active', 'Matrix 用户名已经确定');
    if (!account.username_provisional) fail(409, 'confirmed', '用户名已经确认');
    const name = stringField(body.username);
    await checkUsername(env, name, account);
    const update = await env.DB.prepare(
      `UPDATE accounts SET username=?, username_provisional=0
      WHERE id=? AND username_provisional=1 AND matrix_user_id IS NULL AND matrix_status<>'active'
      AND NOT EXISTS(SELECT 1 FROM auth_tickets WHERE username=? AND expires_at>?)`,
    )
      .bind(name, account.id, name, Date.now())
      .run();
    if (!update.meta.changes) fail(409, 'username_taken', '该用户名已预留或账号已经确认');
  } else {
    if (account.role === 'admin') fail(403, 'admin_account', '请通过后台管理管理员凭据');
    const id = account.id;
    const sessionHash = await sha256Hex(readCookie(request, SESSION_COOKIE));
    const liveSession =
      'EXISTS(SELECT 1 FROM auth_sessions WHERE token_hash=? AND account_id=accounts.id AND expires_at>?)';
    const revoke = env.DB.prepare(
      'DELETE FROM auth_sessions WHERE account_id=? AND token_hash<>? AND changes()>0',
    ).bind(id, sessionHash);
    const row = await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first<Credentials>();
    if (!row) fail(401, 'unauthorized', '请重新登录');
    if (path.startsWith('/auth/email/change/')) {
      const email = normalizeEmail(body.new_email);
      if (!isEmail(email)) fail(400, 'bad_email', '请输入有效的新邮箱');
      if (
        email === row.email ||
        (await identityOwner(env, 'email', email)) ||
        (await env.DB.prepare('SELECT 1 FROM accounts WHERE email=?').bind(email).first())
      )
        fail(409, 'email_taken', '这个邮箱已使用');
      const purpose = 'change_email:' + id + ':' + sessionHash;
      if (path.endsWith('/start')) return sendCode(env, request, email, purpose);
      await checkCode(env, request, email, body.code, purpose);
      const now = Date.now();
      const changed = 'EXISTS(SELECT 1 FROM accounts WHERE id=? AND email=?)';
      const [result] = await env.DB.batch([
        env.DB.prepare(
          `UPDATE accounts SET email=?,email_hash=?,email_verified_at=? WHERE id=? AND email=? AND ${liveSession}`,
        ).bind(email, emailHashOf(email), now, id, row.email, sessionHash, now),
        env.DB.prepare(
          `INSERT OR IGNORE INTO account_identities(account_id,provider,uid,created_at) SELECT ?,'email',?,? WHERE ${changed}`,
        ).bind(id, row.email, now, id, email),
        env.DB.prepare(
          `INSERT INTO account_identities(account_id,provider,uid,created_at) SELECT ?,'email',?,? WHERE ${changed}`,
        ).bind(id, email, now, id, email),
        env.DB.prepare(
          `INSERT INTO account_security_log SELECT ?,'change_email',?,? WHERE ${changed}`,
        ).bind(id, await ipHash(request, env), now, id, email),
        revoke,
      ]);
      if (!result.meta.changes) fail(409, 'changed', '账号已更改，请重新登录');
    } else {
      const reset = 'reset_password:' + id + ':' + sessionHash;
      if (path.endsWith('/reset/start')) return sendCode(env, request, row.email, reset);
      if (path === '/auth/matrix/activate' || (row.pass_hash && !body.code)) {
        const pass = stringField(
          path === '/auth/matrix/activate' ? body.password : body.old_password,
        ).trim();
        const attempt = await takeAttempt(env, request, 'reauth', 10, 600000);
        if (!row.pass_hash || !(await matches(pass, row))) fail(401, 'bad_credentials', '当前密码不对');
        await env.DB.prepare('DELETE FROM auth_attempts WHERE id=?').bind(attempt.id).run();
        if (path === '/auth/matrix/activate') {
          if (account.username_provisional) fail(409, 'provisional', '请先确认用户名');
          await syncMatrix(env, account, pass, row.pass_hash!);
        }
      }
      if (path === '/auth/password') {
        const password = stringField(body.new_password).trim();
        checkPassword(password, row.username, row.email);
        if (body.code) await checkCode(env, request, row.email, body.code, reset);
        const salt = randomToken(16);
        const update = env.DB.prepare(
          `UPDATE accounts SET pass_hash=?,salt=?,iterations=?, password_set_at=coalesce(password_set_at,?),
          locked_until=NULL,failed_logins=0,matrix_pw_synced_at=NULL WHERE id=? AND pass_hash IS ? AND ${liveSession}`,
        ).bind(
          await pbkdf2(password, salt),
          salt,
          PBKDF2_ITER,
          Date.now(),
          id,
          row.pass_hash,
          sessionHash,
          Date.now(),
        );
        const [r] = await env.DB.batch([update, revoke]);
        if (!r.meta.changes) fail(409, 'changed', '凭据已更改，请重新登录');
      }
    }
  }
  const fresh = await findAccountById(env, account.id);
  const view = fresh && (await publicAccount(env, fresh));
  return json({ ok: true, account: view, matrix: view?.matrix }, 200, headers);
}
