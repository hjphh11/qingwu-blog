/**
 * 站内账号头像 · 出站专用代理
 *
 * 出站消息的 `[URL:]` 一律指向这里，而不是直接给 `avatarFromEmail()` 算出来的那张。
 * 两个原因，都是踩出来的：
 *
 * 1. **`q.qlogo.cn` 在境外回 400**。我们自己的香港机实测：带不带 Referer、带不带 UA
 *    都是 `400 text/plain 0B`（`q1`/`q2.qlogo.cn` 同一张图却是 200）。对方站点只要
 *    不在大陆，就加载不出来 —— 表现就是大厅里一排默认头像，协议头写了也白写。
 * 2. **那个 URL 的 `dst_uin` 是明文 QQ 号**，转发到大厅等于把号贴在公屏上。
 *
 * 所以对方只访问 `www.qingwu.ink`，取图由 worker 代劳。上游按
 * 「账号自填的绝对地址 → 站内相对路径 → qlogo(q2 分片) → 原 qlogo → cravatar」逐个试。
 */
import type { Env } from '../types';
import { avatarFromEmail } from '../auth/avatar';

const SITE_FALLBACK = 'https://www.qingwu.ink';

/** 头像边长（1024 以内都便宜，100 在聊天气泡里刚好） */
const AVATAR_PX = 100;

/** 出站消息里给对方的绝对地址 */
export function publicAvatarUrl(site: string, accountId: number): string {
  const base = String(site || SITE_FALLBACK).replace(/\/+$/, '');
  return `${base}/api/chat/avatar/u/${accountId}`;
}

/** 上游候选（按顺序试） */
function upstreamOf(site: string, email: string | null, avatar: string | null): string[] {
  const out: string[] = [];
  const av = String(avatar || '').trim();

  if (/^https:\/\//i.test(av)) out.push(av);
  else if (av.startsWith('/')) out.push(`${site}${av}`);

  const gen = avatarFromEmail(email || '', AVATAR_PX);
  if (gen) {
    // qlogo 统一入口在境外 400，但 q1/q2 是同一张图的分片 —— 换一个再试
    if (gen.includes('//q.qlogo.cn/')) out.push(gen.replace('//q.qlogo.cn/', '//q2.qlogo.cn/'));
    out.push(gen);
  }
  return out;
}

/**
 * `GET /chat/avatar/u/:id` —— 公开，不需要登录。
 *
 * 头像本来就是公开信息（站内留言板、评论区都直接显示），这里只是换个可访问的地址。
 */
export async function getAccountAvatar(env: Env, idParam: string): Promise<Response> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return transparent1px();

  const site = String(env.SITE_URL ?? '').trim().replace(/\/+$/, '') || SITE_FALLBACK;

  const row = await env.DB.prepare(`SELECT email, avatar_url FROM accounts WHERE id = ?`)
    .bind(id)
    .first<{ email: string | null; avatar_url: string | null }>();
  if (!row) return transparent1px();

  for (const u of upstreamOf(site, row.email, row.avatar_url)) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) continue;
      return new Response(res.body, {
        status: 200,
        headers: {
          'content-type': ct,
          // 对方和中间层都会缓存；本人换头像后最多一周生效，够用
          'cache-control': 'public, max-age=604800',
        },
      });
    } catch {
      /* 试下一个上游 */
    }
  }
  return transparent1px();
}

/** 拿不到时回一张透明图：前端不会出现破图图标 */
function transparent1px(): Response {
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
    (c) => c.charCodeAt(0),
  );
  return new Response(png as unknown as BodyInit, {
    status: 200,
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' },
  });
}
