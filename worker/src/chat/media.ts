// 长亭 · 图片 / 视频消息
//
//   POST /chat/media      上传（JSON：data URL + 尺寸）
//   GET  /chat/media/:id  读取（只服务早期存在库里的老数据）
//
// ## 存哪：优先 R2，没有凭据就回退 SQLite
//
// 「R2 没启用」曾经是个误判 —— `[[r2_buckets]]` 绑定确实是注释掉的，
// 但桶 `qingwu-uploads` 一直在用：`img.qingwu.ink` 公开可读，画市一万两千张图在里面。
//
// ⚠️ 为什么不直接用 `[[r2_buckets]]` 绑定：生产是 `wrangler dev --local`，
//    那种绑定会模拟成本地目录，图根本到不了云端。所以走 **R2 的 S3 API + SigV4**，
//    纯 fetch + Web Crypto，不依赖 SDK。
//
// 没配凭据时（本地开发、或还没配）自动落回 SQLite —— 功能不坏，只是别处看不到图。
//
// ## 为什么消息只存 media_id
//
// 一条图片消息在 poll 里每 2.5 秒重发一次，二进制塞进 JSON 等于让轮询流量翻十倍。
// 消息只记 id，图走独立地址（R2 走 CDN 一年缓存 / 库里的走 /chat/media/:id）。

import type { Env } from '../types';
import { json } from '../util';
import { sessionUser } from '../auth/store';

/** 上限（解码后的字节）。有 R2 时放宽 —— R2 出网不计费，且没有单行大小限制 */
const LIMIT_SQLITE = { image: 1024 * 1024, video: 5 * 1024 * 1024, file: 5 * 1024 * 1024 } as const;
const LIMIT_R2 = { image: 4 * 1024 * 1024, video: 32 * 1024 * 1024, file: 5 * 1024 * 1024 } as const;

const IMAGE_MIME = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

/**
 * 任意文件：**白名单**，不是黑名单。
 *
 * 这些字节将来会以 `content-type` 原样从 worker 吐出去（回退到 SQLite 时还和站点同源），
 * 所以绝不能收 `text/html`、`image/svg+xml` 这类能被当页面执行的类型 ——
 * 一个 svg 里塞 script，就成了本站域名下的 XSS。只收「打开也只是个文件」的格式。
 */
const FILE_MIME = new Set([
  'application/pdf',
  'application/zip',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/epub+zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** 只接受白名单里的 mime —— 存进来的字节将来会以 `content-type` 原样吐出去 */
function kindOf(mime: string): 'image' | 'video' | 'file' | null {
  if (IMAGE_MIME.has(mime)) return 'image';
  if (VIDEO_MIME.has(mime)) return 'video';
  if (FILE_MIME.has(mime)) return 'file';
  return null;
}

const EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/epub+zip': 'epub',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/**
 * 原始文件名清洗。
 *
 * 这个名字会进 Content-Disposition 响应头，也会显示在下载卡片上：
 * 所以去掉路径分隔符与控制字符（防 header 注入），截到 60 字符，
 * 并且**绝不信任客户端传的扩展名** —— 扩展名按 mime 兜底。
 */
function cleanName(raw: unknown, mime: string): string {
  const fallback = `文件.${EXT[mime] ?? 'bin'}`;
  const name = String(raw ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim();
  if (!name) return fallback;
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).slice(0, 60) || '文件';
  const ext = dot > 0 ? name.slice(dot + 1).slice(0, 8) : (EXT[mime] ?? 'bin');
  return `${base}.${ext}`;
}

function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s+/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

// ——————————————————————————————————————————————————————————
// SigV4（R2 的 S3 API 只认这个）
// ——————————————————————————————————————————————————————————

function hexOf(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buf =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
  return hexOf(await crypto.subtle.digest('SHA-256', buf));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
}

interface R2Cfg {
  account: string;
  bucket: string;
  accessKey: string;
  secret: string;
  publicBase: string;
}

/** 三个凭据齐了才算能用 R2 */
function r2Of(env: Env): R2Cfg | null {
  const account = String(env.R2_ACCOUNT_ID ?? '').trim();
  const accessKey = String(env.R2_ACCESS_KEY_ID ?? '').trim();
  const secret = String(env.R2_SECRET_ACCESS_KEY ?? '').trim();
  if (!account || !accessKey || !secret) return null;
  return {
    account,
    bucket: String(env.R2_BUCKET ?? '').trim() || 'qingwu-uploads',
    accessKey,
    secret,
    publicBase: (String(env.R2_PUBLIC_BASE ?? '').trim() || 'https://img.qingwu.ink').replace(/\/+$/, ''),
  };
}

/**
 * PUT 一个对象到 R2。成功返回公共 URL，失败返回 null（调用方会回退到存库）。
 *
 * 签名只签 `host` / `x-amz-content-sha256` / `x-amz-date` 三个头 ——
 * `content-type` 不签也能生效（R2 会照样存下来），少签一个少一处出错的可能。
 */
async function putToR2(
  cfg: R2Cfg,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const host = `${cfg.account}.r2.cloudflarestorage.com`;
  const region = 'auto';

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(bytes);

  const canonicalUri = `/${cfg.bucket}/${key}`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const canonicalRequest =
    `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;

  let k = await hmac(new TextEncoder().encode(`AWS4${cfg.secret}`), dateStamp);
  k = await hmac(k, region);
  k = await hmac(k, 's3');
  k = await hmac(k, 'aws4_request');
  const signature = hexOf(await hmac(k, stringToSign));

  try {
    const res = await fetch(`https://${host}${canonicalUri}`, {
      method: 'PUT',
      headers: {
        // host 由 fetch 自己带，这里不设（设了会被拦）
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'content-type': contentType,
        // 文件名带内容哈希，内容永不改 —— 一年缓存
        'cache-control': 'public, max-age=31536000, immutable',
      },
      body: bytes as unknown as BodyInit,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[chat] R2 PUT ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    return `${cfg.publicBase}/${key}`;
  } catch (err) {
    console.error('[chat] R2 PUT 抛错:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ——————————————————————————————————————————————————————————
// 上传
// ——————————————————————————————————————————————————————————

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
    filename?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, reason: 'bad_request', message: '请求格式不对' }, 400);
  }

  const raw = String(payload.data ?? '').trim();
  const m = /^data:([a-z0-9/+.-]+);base64,(.+)$/i.exec(raw);
  if (!m) {
    return json({ ok: false, reason: 'bad_format', message: '只能传图片、视频或文档' }, 400);
  }

  const mime = m[1]!.toLowerCase();
  const kind = kindOf(mime);
  if (!kind) {
    return json(
      {
        ok: false,
        reason: 'bad_type',
        message: '这个格式不支持：图片 jpg/png/webp/gif、视频 mp4/webm、文档 pdf/zip/md/txt/csv/office',
      },
      400,
    );
  }

  const b64 = m[2]!.replace(/\s+/g, '');
  const bytes = base64Bytes(b64);
  if (bytes <= 0) return json({ ok: false, reason: 'bad_format', message: '这个文件是空的' }, 400);

  const cfg = r2Of(env);
  const limit = (cfg ? LIMIT_R2 : LIMIT_SQLITE)[kind];
  if (bytes > limit) {
    const mb = Math.round(limit / 1024 / 1024);
    return json(
      {
        ok: false,
        reason: 'too_large',
        message: `${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '文件'}不能超过 ${mb} MB`,
      },
      413,
    );
  }

  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const now = Date.now();

  /** R2 的对象名：`chat/<时间戳>-<随机>.<ext>`。带随机段是为了两个人在同一毫秒上传也不会撞 */
  const rand = [...crypto.getRandomValues(new Uint8Array(4))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const key = `chat/${now}-${rand}.${EXT[mime] ?? 'bin'}`;

  let url: string | null = null;
  let bin: Uint8Array | null = null;

  if (cfg) {
    bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    url = await putToR2(cfg, key, bin, mime);
    // 上传失败就当作没配 R2，往下走存库这条路 —— 别让人白传一次
  }

  try {
    /**
     * 存 **base64 文本**（回退路径）。
     *
     * 踩过：在这套「miniflare D1 + 本地 SQLite」里 bind 一个 `Uint8Array`
     * 会被序列化成 `137,80,78,71,...` 的十进制串，读回来是垃圾字节。
     * TEXT 存 base64 两边行为一致（体积 +33% 换个可靠）。
     */
    const res = await env.DB.prepare(
      `INSERT INTO chat_media (kind, mime, bytes, data, width, height, duration, account_id, ts, url, filename)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        kind,
        mime,
        bytes,
        url ? '' : b64,
        num(payload.width),
        num(payload.height),
        kind === 'video' ? num(payload.duration) : null,
        me.id,
        now,
        url,
        kind === 'file' ? cleanName(payload.filename, mime) : null,
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
        /** 只有 kind='file' 才有；前端下载卡片显示这个名字 */
        filename: kind === 'file' ? cleanName(payload.filename, mime) : null,
        /** 非空 = 图在 R2，前端直接用；空 = 走 /chat/media/:id */
        url,
      },
      /** 让前端/日志看得出这张图到底存哪了 */
      stored: url ? 'r2' : 'sqlite',
    });
  } catch (err) {
    console.error('[chat] media 入库失败:', err instanceof Error ? err.message : err);
    return json({ ok: false, reason: 'storage', message: '没能存下来，稍后再试' }, 502);
  }
}

// ——————————————————————————————————————————————————————————
// 读取（只服务早期存在库里的老数据；新数据都指向 R2）
// ——————————————————————————————————————————————————————————

export async function getMedia(env: Env, idParam: string): Promise<Response> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return new Response(null, { status: 404 });

  try {
    const row = await env.DB.prepare(
      'SELECT mime, data, url, kind, filename FROM chat_media WHERE id = ?',
    )
      .bind(id)
      .first<{
        mime: string;
        data: string | null;
        url: string | null;
        kind: string | null;
        filename: string | null;
      }>();

    if (!row) return new Response(null, { status: 404 });

    // 新的都在 R2：直接 302 过去，别让 worker 白中转一次大文件
    if (row.url) return Response.redirect(row.url, 302);
    if (!row.data) return new Response(null, { status: 404 });

    let bin: Uint8Array;
    try {
      bin = Uint8Array.from(atob(row.data), (ch) => ch.charCodeAt(0));
    } catch {
      return new Response(null, { status: 500 });
    }

    const isFile = row.kind === 'file';
    const headers: Record<string, string> = {
      'content-type': row.mime || 'application/octet-stream',
      'content-length': String(bin.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
      // 用户上传的内容一律不允许被当成页面执行
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    };
    // 文档一律「下载」而不是「在浏览器里打开」：pdf / html 类的预览面太大
    if (isFile) {
      headers['content-disposition'] =
        `attachment; filename*=UTF-8''${encodeURIComponent(row.filename || 'file')}`;
    }

    return new Response(bin as unknown as BodyInit, { status: 200, headers });
  } catch (err) {
    console.error('[chat] media 读取失败:', err instanceof Error ? err.message : err);
    return new Response(null, { status: 502 });
  }
}
