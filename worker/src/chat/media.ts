// 长亭 · 图片 / 视频消息
//
//   POST /chat/media      上传（JSON：data URL + 尺寸）
//   GET  /chat/media/:id  读取（二进制，一年缓存）
//
// 为什么走独立接口而不是塞进 /chat/send：
//   一条图片消息在 poll 里每 2.5 秒重发一次，二进制塞进 JSON 等于让轮询流量翻十倍。
//   消息只记 media_id，图走这个带长缓存的 URL。
//
// ⚠️ 上传走 `data:` URL 而不是 multipart：workerd 的 FormData 解析对二进制
//    有额外开销，而前端本来就要用 canvas 压缩（压完拿到的是 data URL），
//    再转一次 Blob 纯属绕路。

import type { Env } from '../types';
import { json } from '../util';
import { sessionUser } from '../auth/store';

/** 各类型的上限（解码后的字节）。数字来源见 0029 迁移顶部关于行大小的说明 */
const LIMIT = { image: 1024 * 1024, video: 5 * 1024 * 1024 } as const;

const IMAGE_MIME = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

/** 只接受白名单里的 mime —— 存进来的字节将来会以 `content-type` 原样吐出去 */
function kindOf(mime: string): 'image' | 'video' | null {
  if (IMAGE_MIME.has(mime)) return 'image';
  if (VIDEO_MIME.has(mime)) return 'video';
  return null;
}

function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s+/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

export async function uploadMedia(request: Request, env: Env): Promise<Response> {
  let me;
  try {
    me = (await sessionUser(request, env))?.account ?? null;
  } catch {
    me = null;
  }
  if (!me) {
    return json({ ok: false, reason: 'login_required', message: '登录之后才能传图' }, 401);
  }

  let payload: {
    data?: unknown;
    width?: unknown;
    height?: unknown;
    duration?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, reason: 'bad_request', message: '请求格式不对' }, 400);
  }

  const raw = String(payload.data ?? '').trim();
  const m = /^data:([a-z0-9/+.-]+);base64,(.+)$/i.exec(raw);
  if (!m) {
    return json({ ok: false, reason: 'bad_format', message: '只能传图片或视频' }, 400);
  }

  const mime = m[1]!.toLowerCase();
  const kind = kindOf(mime);
  if (!kind) {
    return json(
      { ok: false, reason: 'bad_type', message: '这个格式不支持，换 jpg / png / webp / mp4' },
      400,
    );
  }

  const b64 = m[2]!.replace(/\s+/g, '');
  const bytes = base64Bytes(b64);
  const max = LIMIT[kind];
  if (bytes <= 0) return json({ ok: false, reason: 'bad_format', message: '这个文件是空的' }, 400);
  if (bytes > max) {
    const mb = (max / 1024 / 1024).toFixed(kind === 'image' ? 0 : 0);
    return json(
      { ok: false, reason: 'too_large', message: `${kind === 'image' ? '图片' : '视频'}不能超过 ${mb} MB` },
      413,
    );
  }

  try {
    /**
     * 存 **base64 文本**，不存 BLOB。
     *
     * 踩过一次才明白：生产是「miniflare 的 D1 绑定 + 本地 SQLite」这套混搭，
     * 直接 bind 一个 `Uint8Array` 会被序列化成 `137,80,78,71,...` 这样的十进制串 ——
     * 读回来再 `new Response()` 就是一段 198 字节的垃圾，不是 PNG。
     * TEXT 列存 base64 在两边行为一致，代价是体积 +33%，值得。
     */
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    };

    const res = await env.DB.prepare(
      `INSERT INTO chat_media (kind, mime, bytes, data, width, height, duration, account_id, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        kind,
        mime,
        bytes,
        b64,
        num(payload.width),
        num(payload.height),
        kind === 'video' ? num(payload.duration) : null,
        me.id,
        Date.now(),
      )
      .run();

    return json({
      ok: true,
      media: {
        id: Number(res.meta.last_row_id),
        kind,
        mime,
        bytes,
        width: num(payload.width),
        height: num(payload.height),
        duration: kind === 'video' ? num(payload.duration) : null,
      },
    });
  } catch (err) {
    console.error('[chat] media 上传失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '没能存下来，稍后再试' }, 502);
  }
}

export async function getMedia(env: Env, idParam: string): Promise<Response> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(null, { status: 404 });
  }

  try {
    const row = await env.DB.prepare('SELECT mime, data FROM chat_media WHERE id = ?')
      .bind(id)
      .first<{ mime: string; data: string }>();

    if (!row || !row.data) return new Response(null, { status: 404 });

    // data 是 base64 文本（见 uploadMedia 里的说明），这里解码成真正的二进制
    let bin: Uint8Array;
    try {
      bin = Uint8Array.from(atob(row.data), (ch) => ch.charCodeAt(0));
    } catch {
      return new Response(null, { status: 500 });
    }

    /**
     * 一年 + immutable：文件名就是 id，内容永不改。
     * 消息被删了图还留着也不打紧 —— 没有 id 就没人找得到它。
     */
    return new Response(bin, {
      status: 200,
      headers: {
        'content-type': row.mime || 'application/octet-stream',
        'content-length': String(bin.byteLength),
        'cache-control': 'public, max-age=31536000, immutable',
        // 用户上传的内容一律不允许被当成页面执行
        'content-security-policy': "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('[chat] media 读取失败:', err instanceof Error ? err.message : err);
    return new Response(null, { status: 502 });
  }
}
