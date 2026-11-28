// 清吾 · 账号档案（对外的形状 / 登录锚点 / 我的留言）
//
// 「按邮箱认人」这件事**只在这里写一遍**：邮箱验证码与 GitHub 回调都走 anchorLogin，
// 不在各自的 handler 里各写一份 —— 两份迟早会不一致，然后就会出现同一个人两个账号。

import type { Env } from '../types';
import { maskEmail, normalizeEmail } from './common';
import { avatarFromEmail } from './avatar';
import {
  attachIdentity,
  findAccountByEmail,
  listIdentities,
  touchAccount,
  type AccountRow,
} from './store';

export interface PublicIdentity {
  provider: 'email' | 'github';
  /** 给人看的：邮箱打码 / GitHub 登录名 */
  label: string;
  /** 可解绑？（邮箱是锚点，不允许解绑；管理员同理） */
  removable: boolean;
}

export interface PublicAccount {
  id: number;
  name: string;
  /** 打码后的邮箱，**原文永不出网** */
  email: string;
  username: string;
  usernameProvisional: boolean;
  hasPassword: boolean;
  emailVerified: boolean;
  matrix: { status: string; userId: string | null; passwordSyncPending: boolean };
  emailHash: string;
  avatar: string;
  /** 头像是自己传的（true）还是按邮箱算出来的（false）—— 前端据此决定输入框里要不要回填 */
  avatarCustom: boolean;
  site: string;
  /** 自己写的一句简介；空串 = 没写 */
  bio: string;
  role: 'visitor' | 'admin';
  since: number;
  identities: PublicIdentity[];
}

function metaOf(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function publicAccount(env: Env, account: AccountRow): Promise<PublicAccount> {
  const list = await listIdentities(env, account.id);
  const identities: PublicIdentity[] = list.filter(i => i.provider !== 'email' || i.uid === account.email).map((i) => {
    if (i.provider === 'github') {
      const meta = metaOf(i.meta);
      const login = String(meta.login ?? '') || `github:${i.uid}`;
      return { provider: 'github' as const, label: login, removable: true };
    }
    return { provider: 'email' as const, label: maskEmail(account.email), removable: false };
  });

  // 老账号可能没有 identity 行（迁移建号时只写了 accounts），补一个展示用的
  if (!identities.some((i) => i.provider === 'email')) {
    identities.unshift({ provider: 'email', label: maskEmail(account.email), removable: false });
  }

  return {
    id: account.id,
    username: account.username,
    usernameProvisional: Boolean(account.username_provisional),
    hasPassword: Boolean(account.has_password),
    emailVerified: Boolean(account.email_verified_at),
    matrix: { status: account.matrix_status, userId: account.matrix_user_id,
      passwordSyncPending: account.matrix_status === 'active' && !account.matrix_pw_synced_at },
    name: account.display_name || '匿名朋友',
    email: maskEmail(account.email),
    emailHash: account.email_hash,
    avatar: account.avatar_url || avatarFromEmail(account.email),
    avatarCustom: Boolean(account.avatar_url),
    site: account.site_url || '',
    bio: account.bio || '',
    role: account.role === 'admin' ? 'admin' : 'visitor',
    since: account.created_at,
    identities,
  };
}

export type AnchorResult =
  | { ok: true; account: AccountRow }
  | { ok: false; reason: 'conflict' };

/**
 * 把「没登录时用同一个邮箱留的言」认领到这个账号。
 *
 * 为什么必须有这一步：留言归属只认 `account_id`，未登录发的只有 `email_hash`。
 * 少了它，同一个人登录后看不到自己半小时前说的话，而且**没有任何办法补** ——
 * 前台只会说「还没有用这个邮箱留过言」，看起来就像丢数据。
 *
 * 匹配靠 `email_hash`（= md5(trim+lower(email))，无盐确定性，和未登录提交时算的是同一份）；
 * 更老的留言可能没存 hash，再用明文邮箱对一次。
 *
 * 认领后把明文邮箱清掉 —— 登录态的留言本来就不落明文（见 friends-board 的 POST）。
 * 全程 try/catch：认领不到顶多列表少几条，不该让登录本身失败。
 */
export async function claimComments(env: Env, account: AccountRow): Promise<number> {
  try {
    const r = await env.DB.prepare(
      `UPDATE comments
          SET account_id = ?, email = NULL
        WHERE account_id IS NULL
          AND (
            (email_hash IS NOT NULL AND email_hash = ?)
            OR (email_hash IS NULL AND email IS NOT NULL AND lower(trim(email)) = ?)
          )`,
    )
      .bind(account.id, account.email_hash, account.email.toLowerCase())
      .run();
    return r.meta?.changes ?? 0;
  } catch (err) {
    console.error('[auth] 历史留言认领失败:', err instanceof Error ? err.message : err);
    return 0;
  }
}

/** 验证过的邮箱或已绑定的 GitHub 只登录已有账号。 */
export async function anchorLogin(
  env: Env,
  input: {
    email: string;
    provider: 'email' | 'github';
    uid: string;
    meta?: Record<string, unknown>;
  },
): Promise<AnchorResult> {
  const email = normalizeEmail(input.email);
  const account = await findAccountByEmail(env, email);
  if (!account || account.status !== 'active') return { ok: false, reason: 'conflict' };

  const primary = await attachIdentity(env, account.id, 'email', email);
  if (primary === 'taken') return { ok: false, reason: 'conflict' };

  if (input.provider !== 'email') {
    const linked = await attachIdentity(env, account.id, input.provider, input.uid, input.meta);
    if (linked === 'taken') return { ok: false, reason: 'conflict' };
  }

  await touchAccount(env, account.id);

  // 认领历史留言（同邮箱、未登录时发的）—— 每次登录都做，不只建号时做。
  // 场景：先在这台设备登录过，后来退出/换浏览器用同一邮箱留了言，再登回来。
  const claimed = await claimComments(env, account);
  if (claimed) console.log(`[auth] 认领 ${claimed} 条历史留言 → 账号 ${account.id}`);

  return { ok: true, account };
}
