import type { Env } from '../types';
import { json } from '../util';
import { usernameError, validNickname, validPassword } from './rules';
import { corsHeaders, ipHash, isEmail, normalizeEmail, randomToken, sha256Hex } from './common';
import { findAccountByEmail, identityOwner } from './store';
import { emailHashOf } from './md5';
import { checkCode, fail, sendCode, signedIn, stringField, takeAttempt } from './flow';
import { pbkdf2, PBKDF2_ITER } from './password';
import { syncMatrix } from './matrix';

const TICKET_TTL_MS = 10 * 60 * 1000;
type Ticket = {
  id: string;
  username: string;
  nickname: string;
  email: string;
  token_hash: string | null;
};

export async function checkUsername(env: Env, username: string, exceptId = 0) {
  const error = usernameError(username);
  if (error) fail(error[0] === 'username_reserved' ? 409 : 400, error[0], error[1]);
  if (
    await env.DB.prepare('SELECT 1 FROM accounts WHERE username=? AND id<>?')
      .bind(username, exceptId)
      .first()
  ) {
    fail(409, 'username_taken', '这个用户名已经有人用了，换一个吧');
  }
}
export function checkPassword(password: string, username: string, email: string) {
  if (!validPassword(password, username, email))
    fail(400, 'weak_password', '密码需为 8–72 位，不能为纯数字、用户名或邮箱前缀');
}
export async function register(env: Env, request: Request, path: string, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  const headers = corsHeaders(request, env);
  const now = Date.now();
  await env.DB.prepare('DELETE FROM auth_tickets WHERE expires_at<=?').bind(now).run();
  if (path.endsWith('/start')) {
    if (body.hp) return json({ ok: true, cooldown: 60 }, 200, headers);
    await takeAttempt(env, request, 'register', 5, 3600000);
    const username = stringField(body.username);
    const nickname = stringField(body.nickname);
    await checkUsername(env, username);
    if (!validNickname(nickname))
      fail(400, 'bad_nickname', '昵称需为 1–20 个字，最多 3 个 emoji，首尾不能有空格');
    if (!isEmail(email)) fail(400, 'bad_email', '邮箱格式看起来不对');
    const existing = await findAccountByEmail(env, email);
    if (existing || (await identityOwner(env, 'email', email))) {
      if (existing && !existing.has_password)
        fail(409, 'email_taken_no_password', '这个邮箱已注册，请用验证码登录后设置密码');
      fail(409, 'email_taken', '这个邮箱已使用，请去登录');
    }
    const id = randomToken(16);
    const inserted = await env.DB.prepare(
      'INSERT OR IGNORE INTO auth_tickets(id,email,username,nickname,expires_at) VALUES (?,?,?,?,?)',
    )
      .bind(id, email, username, nickname, now + TICKET_TTL_MS)
      .run();
    const ticket = await env.DB.prepare('SELECT * FROM auth_tickets WHERE email=?')
      .bind(email)
      .first<Ticket>();
    if (!ticket) fail(409, 'username_taken', '这个用户名已被预留，请换一个');
    if (ticket.username !== username || ticket.nickname !== nickname || ticket.token_hash) {
      fail(409, 'reservation_conflict', '资料已被暂时预留，请换个用户名或十分钟后重试');
    }
    const result = await sendCode(env, request, email, 'register:' + ticket.id);
    if (!result.ok && inserted.meta.changes)
      await env.DB.prepare(
        'DELETE FROM auth_tickets WHERE id=? AND NOT EXISTS(SELECT 1 FROM auth_codes WHERE purpose=?)',
      )
        .bind(id, 'register:' + id)
        .run();
    if (result.ok)
      await env.DB.prepare('UPDATE auth_tickets SET expires_at=? WHERE id=? AND token_hash IS NULL')
        .bind(Date.now() + TICKET_TTL_MS, ticket.id)
        .run();
    return result;
  }
  if (path.endsWith('/verify')) {
    const row = await env.DB.prepare('SELECT * FROM auth_tickets WHERE email=? AND token_hash IS NULL')
      .bind(email)
      .first<Ticket>();
    if (!row) fail(400, 'code_expired', '注册已过期，请重新发码');
    await checkCode(env, request, email, body.code, 'register:' + row.id);
    const token = randomToken(32);
    const saved = await env.DB.prepare(
      'UPDATE auth_tickets SET token_hash=?, expires_at=? WHERE id=? AND expires_at>? AND token_hash IS NULL',
    )
      .bind(await sha256Hex(token), now + TICKET_TTL_MS, row.id, now)
      .run();
    if (!saved.meta.changes) fail(400, 'code_expired', '注册已过期，请重新发码');
    return json({ ok: true, ticket: token }, 200, headers);
  }
  const hash = await sha256Hex(stringField(body.ticket));
  const row = await env.DB.prepare('SELECT * FROM auth_tickets WHERE token_hash=?')
    .bind(hash)
    .first<Ticket>();
  if (!row) fail(400, 'invalid_ticket', '注册凭证已失效，请重新发码');
  const password = stringField(body.password).trim();
  checkPassword(password, row.username, row.email);
  const salt = randomToken(16);
  const passHash = await pbkdf2(password, salt);
  const [created] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO accounts(username,display_name,email,email_hash,pass_hash,salt,iterations,created_at,email_verified_at,password_set_at,matrix_status)
      SELECT username,nickname,email,?,?,?,?,?,?,?,'pending' FROM auth_tickets WHERE token_hash=? AND expires_at>?`,
    ).bind(emailHashOf(row.email), passHash, salt, PBKDF2_ITER, now, now, now, hash, Date.now()),
    env.DB.prepare(
      `INSERT INTO account_identities(account_id,provider,uid,created_at)
      SELECT a.id,'email',a.email,? FROM accounts a JOIN auth_tickets t ON t.email=a.email WHERE t.token_hash=? AND changes()=1`,
    ).bind(now, hash),
    env.DB.prepare(
      'DELETE FROM auth_attempts WHERE ip_hash=? AND EXISTS(SELECT 1 FROM auth_tickets WHERE token_hash=?)',
    ).bind('register:' + (await ipHash(request, env)), hash),
    env.DB.prepare('DELETE FROM auth_tickets WHERE token_hash=?').bind(hash),
  ]);
  if (!created.meta.changes) fail(400, 'invalid_ticket', '注册凭证已失效');
  const account = await findAccountByEmail(env, row.email);
  if (!account) throw Error('account_create_failed');
  await syncMatrix(env, account, password, passHash);
  return signedIn(env, request, account.id, passHash, row.email);
}
