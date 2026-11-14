/**
 * 「同一个人」的判定 —— 评论区里所有「按人去重」的地方都从这里取。
 *
 * 为什么单独一个文件：`visitorKey` 原来写在 friends-board.ts 里，
 * 而登录流程（auth/index.ts）也要用它把「没登录时点的赞」搬到账号上。
 * 两边互相 import 会绕成一个环，所以下沉到这儿。
 */

import type { Env } from './types';

/**
 * 客户端 IP。GeoIP 的 `x-q-country` 与本文件无关，别搞混。
 *
 * ⚠️ **只信 `x-real-ip`** —— 这一个头由 nginx 用 `$remote_addr` 覆盖写（见
 * deploy/nginx/qingwu.conf 的 `proxy_set_header X-Real-IP $remote_addr;`），
 * 客户端自带的同名头会被 nginx 顶掉。
 *
 * `cf-connecting-ip` / `x-forwarded-for` 都是**客户端能自带**的头：
 * 站点 2026-11-10 搬离 Cloudflare 之后，边缘不再写 cf-connecting-ip，
 * 谁都能伪造一个 → 去重、限流、锁定全部失效（实测可无限刷 /hit）。
 * nginx 侧另有 `proxy_set_header CF-Connecting-IP "";` 兜底。
 */
export function clientIp(request: Request): string {
  const real = (request.headers.get('x-real-ip') || '').trim();
  return real || '0.0.0.0';
}

/**
 * 匿名访客标识（IP + UA 哈希截断，不落明文）。
 * 点赞去重与限流都用它；登录后改用 `a<id>`（见 friends-board 的 likeKeyOf）。
 */
export async function visitorKey(request: Request, env: Env): Promise<string> {
  const data = new TextEncoder().encode(
    `${env.HIT_IP_SALT || 'dev'}|${clientIp(request)}|${request.headers.get('user-agent') || ''}`,
  );
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * 把「没登录时点的赞」搬到账号名下。
 *
 * 不搬会怎样：同一个人的赞占两个 key（匿名 `IP|UA`、登录 `a<id>`），
 * 一条留言能被他自己点出两票 —— 实测过。
 *
 * 顺序不能反：**先搬运（冲突就跳过），再删匿名行**。
 * 反过来的话，中间失败就真的把票删没了。
 * 全程 try/catch：搬不动顶多留一条旧票，不该让登录失败。
 */
export async function claimLikes(env: Env, anonKey: string, accountId: number): Promise<number> {
  const key = `a${accountId}`;
  try {
    const moved = await env.DB.prepare(
      `INSERT OR IGNORE INTO friend_likes (comment_id, visitor, ts, account_id)
       SELECT comment_id, ?, ts, ? FROM friend_likes WHERE visitor = ?`,
    )
      .bind(key, accountId, anonKey)
      .run();

    // 搬完再清匿名那几行（此时它们已经在账号名下，删的是重复）
    const removed = await env.DB.prepare('DELETE FROM friend_likes WHERE visitor = ?')
      .bind(anonKey)
      .run();

    const n = (moved.meta?.changes ?? 0) + (removed.meta?.changes ?? 0);
    if (n) console.log(`[visitor] 点赞记录迁移：匿名 → 账号 ${accountId}（${n} 行）`);
    return n;
  } catch (err) {
    console.error('[visitor] 点赞迁移失败:', err instanceof Error ? err.message : err);
    return 0;
  }
}
