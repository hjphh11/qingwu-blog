/**
 * 账号头像：上传、读取、清除。
 *
 * 只接 `data:image/{png,jpeg,webp};base64,…`，而且**前端已经压到 160px**。
 * 这里再卡一道尺寸上限，是为了别把 5MB 的原图直接灌进 D1 —— 前端压缩
 * 是可以被绕过的（改 JS、直接打接口），服务端永远要自己判一遍。
 *
 * 存进去的是 base64 文本（见 0024 迁移的注释），对外只暴露
 * `/api/auth/avatar/<id>?v=<ts>` 这个短地址。
 */

import type { Env } from '../types';

/** 解码后的字节上限。160×160 的 webp 通常 6–12KB，给到 256KB 已经很宽松 */
const MAX_BYTES = 256 * 1024;

/** 允许的图片类型 —— **不收 svg**：SVG 里的脚本在某些场景会执行，没必要为了它开个口子 */
const MIME_OK = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type PutResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'bad_format' | 'too_large' | 'unavailable'; message: string };

/** 头像对外的公共地址前缀（与 nginx 的 `/api/` 去前缀一致） */
export function avatarUrlOf(accountId: number, version: number): string {
  return `/api/auth/avatar/${accountId}?v=${version}`;
}

/**
 * 把 data URL 写进库并把 `accounts.avatar_url` 指向它。
 *
 * 注意这里**不走** `normalizeUrl()` —— 那会把 `/api/...` 补成 `https://api/...`，
 * 地址就废了。相对路径是我们自己生成的，可信。
 */
export async function putAvatar(env: Env, accountId: number, rawDataUrl: string): Promise<PutResult> {
  const m = /^data:([a-z/+]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec((rawDataUrl || '').trim());
  if (!m) return { ok: false, reason: 'bad_format', message: '只支持 jpg / png / webp' };

  const mime = m[1].toLowerCase();
  if (!MIME_OK.has(mime)) return { ok: false, reason: 'bad_format', message: '只支持 jpg / png / webp' };

  const base64 = m[2].replace(/\s+/g, '');
  // base64 长度换算成字节数：每 4 个字符 3 字节，先粗判再精确算
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_BYTES) {
    return { ok: false, reason: 'too_large', message: '图片太大了，换一张小一点的' };
  }

  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO account_avatars (account_id, mime, data, bytes, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           mime = excluded.mime, data = excluded.data,
           bytes = excluded.bytes, updated_at = excluded.updated_at`,
      ).bind(accountId, mime, base64, bytes, now),
      // avatar_url 指向新地址 —— v 用时间戳，换一张就是新 URL，缓存不会给旧图
      env.DB.prepare('UPDATE accounts SET avatar_url = ? WHERE id = ?').bind(
        avatarUrlOf(accountId, now),
        accountId,
      ),
    ]);
  } catch (err) {
    // 0024 还没迁移时表不存在。**不能让访客看到一个 500** ——
    // 上传是个可选的增强，说一句「暂时存不了」比抛异常体面。
    console.error('[avatar] 写入失败:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'unavailable', message: '头像暂时存不了，稍后再试' };
  }

  return { ok: true, url: avatarUrlOf(accountId, now) };
}

/** 删掉上传的头像，交回「按邮箱算」的那张（QQ 邮箱自然是 QQ 头像） */
export async function clearAvatar(env: Env, accountId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM account_avatars WHERE account_id = ?').bind(accountId),
    env.DB.prepare('UPDATE accounts SET avatar_url = NULL WHERE id = ?').bind(accountId),
  ]).catch((err) => {
    // 同上：0024 没迁移也照样把 avatar_url 清掉，别让「换回默认」失灵
    console.error('[avatar] 清除失败:', err instanceof Error ? err.message : err);
    return env.DB.prepare('UPDATE accounts SET avatar_url = NULL WHERE id = ?').bind(accountId).run();
  });
}

/**
 * 读图。`id` 只认数字，查不到就 404 —— 不区分「没这张图」和「没这个人」，
 * 免得被拿来枚举账号。
 */
export async function getAvatar(env: Env, idRaw: string): Promise<Response> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return new Response('not found', { status: 404 });

  const row = await env.DB.prepare('SELECT mime, data FROM account_avatars WHERE account_id = ?')
    .bind(id)
    .first<{ mime: string; data: string }>()
    .catch(() => null);

  if (!row) return new Response('not found', { status: 404 });

  const bin = Uint8Array.from(atob(row.data), (ch) => ch.charCodeAt(0));

  return new Response(bin, {
    status: 200,
    headers: {
      'content-type': row.mime,
      // 地址里带 ?v=<ts>，同一张图内容永不改变 —— 可以当成永久缓存。
      // 换头像时地址会变，所以不会看到旧图。
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': String(bin.byteLength),
      // 用户上传的内容，别让浏览器猜类型
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
    },
  });
}
