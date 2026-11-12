// 清吾 · 账号档案（对外的形状 / 登录锚点 / 我的留言）
//
// 「按邮箱认人」这件事**只在这里写一遍**：邮箱验证码与 GitHub 回调都走 anchorLogin，
// 不在各自的 handler 里各写一份 —— 两份迟早会不一致，然后就会出现同一个人两个账号。

import type { Env } from '../types';
import { maskEmail, normalizeEmail } from './common';
import { avatarFromEmail } from './avatar';
import {
  attachIdentity,
  createAccount,
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
  emailHash: string;
  avatar: string;
  site: string;
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
  const identities: PublicIdentity[] = list.map((i) => {
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
    name: account.display_name || account.email.split('@')[0] || '匿名朋友',
    email: maskEmail(account.email),
    emailHash: account.email_hash,
    avatar: account.avatar_url || avatarFromEmail(account.email),
    site: account.site_url || '',
    role: account.role === 'admin' ? 'admin' : 'visitor',
    since: account.created_at,
    identities,
  };
}

export type AnchorResult =
  | { ok: true; account: AccountRow; created: boolean }
  | { ok: false; reason: 'conflict' };

/**
 * 邮箱锚点：**任何拿到已验证邮箱的入口都走这里**。
 *
 *   · 邮箱已存在 → 登进那个账号（把本次 provider 记上，这就是「多登录方式互通」）
 *   · 邮箱不存在 → 建号 + 记 email identity
 *   · 该 provider 的 uid 已属于**另一个**账号 → 冲突（不自动合并，见方案 §3）
 *
 * `profile` 只用于建号时的初始档案；已存在的账号不会被覆盖 ——
 * 否则每次用 GitHub 登录都会把用户自己改过的署名冲掉。
 */
export async function anchorLogin(
  env: Env,
  input: {
    email: string;
    provider: 'email' | 'github';
    uid: string;
    meta?: Record<string, unknown>;
    profile?: { name?: string; site?: string; avatar?: string };
  },
): Promise<AnchorResult> {
  const email = normalizeEmail(input.email);
  let account = await findAccountByEmail(env, email);
  let created = false;

  if (!account) {
    account = await createAccount(env, {
      email,
      displayName: input.profile?.name,
      siteUrl: input.profile?.site,
      avatarUrl: input.profile?.avatar || avatarFromEmail(email),
    });
    created = true;
  }

  const primary = await attachIdentity(env, account.id, 'email', email);
  if (primary === 'taken') return { ok: false, reason: 'conflict' };

  if (input.provider !== 'email') {
    const linked = await attachIdentity(env, account.id, input.provider, input.uid, input.meta);
    if (linked === 'taken') return { ok: false, reason: 'conflict' };
  }

  await touchAccount(env, account.id);
  return { ok: true, account, created };
}
