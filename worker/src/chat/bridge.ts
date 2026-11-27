/**
 * 茶室互联 · 出站（清吾 → matrix.rainzt.cn 的「大厅」）
 *
 * 设计口径见 `docs/方案-聊天室.md` §46.5 / §46.6。这里只做**出站文字**，
 * 入站（/sync）和媒体是后面两步的事 —— 别在这个文件里混进来。
 *
 * ## 为什么走 outbox 而不是「发送时直接 fetch」
 *
 * 1. 用户点发送只该等一个数据库写入。Matrix 那头慢、挂了、限流，跟我们没关系；
 * 2. 挂了要能补发，而不是把那句话永久丢掉；
 * 3. **共享账号要按原发言人分别计数**（对方的三条硬要求之一）—— 排队在这里做最自然：
 *    整条队列按 GAP_MS 平滑拉开，不会攒一批然后在同一毫秒灌给大厅。
 *
 * ## 身份与格式（2026-11-26 对着听雨指南原文核过一遍，改掉了两处想当然）
 *
 * 指南《共享转发账号怎样收发昵称和头像》给的是**正文协议头**这一套：
 *
 *   [ID:清吾];[URL:https://…/avatar.webp]
 *   正文…
 *
 * 1. **`[ID:]` 里放昵称，不是用户 id**。原文：「发送端在 ID 填原昵称」「正文协议以昵称
 *    作为身份键」。我们第一版塞的是 `qingwu-u1`，对方就把人叫成 `qingwu-u1`。
 * 2. **不能再同时发 `org.tea-room.bridge`（v1）**。原文：「听雨当前会优先读有效的 v1 数据，
 *    v1 当前读取 ID、昵称和正文」—— 两套一起发时 v1 会盖掉正文头，而 v1 没有头像字段，
 *    头像就永远打不过去。要头像，只能只发正文头这一套。
 * 3. **`formatted_body` 里不放协议头**：body 给机器读，formatted_body 给人读
 *    （Element 这类客户端优先渲染后者），头露在聊天框里就是那串 `[ID:]`。
 */
import type { Env } from '../types';
import { publicAvatarUrl } from './localAvatar';

/** 站点地址：出站消息的 `site` 字段与相对头像拼绝对地址都用它（rainzt 那边也是带尾斜杠的写法） */
const SITE_FALLBACK = 'https://www.qingwu.ink';

/** 队列里两条之间至少隔这么久 —— 平滑出站，避免同一秒连发一串 */
const GAP_MS = 1200;

/** 单次 flush 最多处理几条（cron 一分钟一次，够用；也避免一轮跑太久） */
const BATCH = 20;

/** 最多重试几次，之后标 failed 等人工看 */
const MAX_TRIES = 6;

/** 待审消息先压一会儿：等审核出结果再决定发不发，别把可能违规的话推到大厅 */
const PENDING_DELAY_MS = 60_000;

export type BridgeCfg = {
  hs: string;
  room: string;
  token: string;
  /** 对外站点地址（带尾斜杠），`site` 字段与绝对 URL 拼装用 */
  site: string;
  /**
   * 取站内静态资源（表情图）用的基地址。
   *
   * **不能是 `site`**：worker fetch 自己的公网域名会 `Network connection lost`
   * （NAT 回环被拦），80 端口又整体 301 到 https。生产用 nginx 的
   * `127.0.0.1:8099`（见 deploy/nginx/conf.d/internal-static.conf）。
   */
  assets: string;
};

/** 三个变量齐了才启用；少一个就当没配（本地开发、CI 都是这个状态） */
export function bridgeOf(env: Env): BridgeCfg | null {
  const hs = String(env.MATRIX_HS ?? '').trim().replace(/\/+$/, '');
  const room = String(env.MATRIX_ROOM ?? '').trim();
  const token = String(env.MATRIX_TOKEN ?? '').trim();
  if (!hs || !room || !token) return null;
  const base = String(env.SITE_URL ?? '').trim().replace(/\/+$/, '') || SITE_FALLBACK;
  const assets = String(env.INTERNAL_ORIGIN ?? '').trim().replace(/\/+$/, '') || base;
  return { hs, room, token, site: `${base}/`, assets };
}

function rand(n = 10): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}


/**
 * 排队一条出站。
 *
 * 调用点只有 `sendMessage`（本站发的消息）。`pending`（审核中）也入队，但推迟一分钟：
 * 到点由 flush 重新看一眼状态 —— 转正了就发，变成 spam / 撤回了就**悄悄丢掉**。
 * 这样不用去改审核那条链路（judgeLater 里再插一次回调，很容易漏分支）。
 */
export async function queueBridge(
  env: Env,
  opts: { messageId: number; kind: string; status: string },
): Promise<void> {
  if (!bridgeOf(env)) return;
  // 文字与图片；视频 / 文件 / 语音还没做（§46.5 第 4 步的后半段）
  if (opts.kind !== 'text' && opts.kind !== 'image') return;

  const now = Date.now();
  const delay = opts.status === 'pending' ? PENDING_DELAY_MS : 0;

  // 排在队列末尾：取当前最大的 next_at 再加一个 GAP，保证平滑出站
  const tail = await env.DB.prepare(
    `SELECT MAX(next_at) AS t FROM chat_outbox WHERE status IN ('queued', 'sending')`,
  ).first<{ t: number | null }>();
  const floor = Number(tail?.t ?? 0) > now ? Number(tail!.t) : now;
  const nextAt = floor + (floor === now ? 0 : GAP_MS) + delay;

  await env.DB.prepare(
    `INSERT INTO chat_outbox (message_id, op, txn_id, status, tries, next_at, created_at)
     VALUES (?, 'send', ?, 'queued', 0, ?, ?)`,
  )
    .bind(opts.messageId, `qingwu-${opts.messageId}-${rand(6)}`, nextAt, now)
    .run();
}

export type BridgeRow = {
  body: string;
  nick: string;
  avatar: string;
  accountId: number;
  txn: string;
  /** 这条消息在大厅里引用的是哪个事件（`$…`）—— 没有就不带引用关系 */
  replyEventId?: string;
};

/**
 * 出站署名的站点后缀 —— 站长定的口径：`昵称·清吾长亭`。
 *
 * 为什么带站点名：大厅里十几个站的人混在一起，光一个「茶客甲」看不出从哪儿来。
 * 听雨那边登记转发账号后会另挂来源标签，但 Matrix 原生客户端只看得到这个昵称，
 * 后缀就是给他们看的。
 */
const SITE_SIGN = '清吾长亭';

/**
 * 拼署名。
 *
 * 站长自己的昵称是「清吾」，直接拼会变成「清吾·清吾长亭」—— 重复得难看。
 * 所以昵称本身是站点名前缀时（「清吾」之于「清吾长亭」）只留后缀。
 * 用 `startsWith` 而不是硬编码 `=== '清吾'`，以后站名改了不用动这里。
 */
export function signOf(rawNick: string): string {
  // 协议头是拿「方括号 + 分号」拼的：昵称里混进这些字符会把对方的解析带偏
  const base = String(rawNick || '')
    .replace(/[[\]\r\n]/g, '')
    .trim();
  if (!base) return SITE_SIGN;
  if (base === SITE_SIGN || (base.length >= 2 && SITE_SIGN.startsWith(base))) return SITE_SIGN;
  return `${base}·${SITE_SIGN}`;
}

/**
 * 出站报文的**全部格式逻辑**都在这儿（纯函数，好单测）。
 *
 * 格式与取舍见文件头：`[ID:昵称·清吾长亭];[URL:头像]` + 换行 + 原文，**不带 v1 结构化**。
 */
export function bridgeContentOf(row: BridgeRow): Record<string, unknown> {
  const nick = signOf(row.nick);
  const head = `[ID:${nick}];[URL:${row.avatar}]`;
  // 首行协议头，换行接原话
  const body = `${head}\n${row.body}`;

  const content: Record<string, unknown> = {
    msgtype: 'm.text',
    body,
    format: 'org.matrix.custom.html',
    // 只放正文：协议头是给解析器看的，不该出现在人读的那一版里
    formatted_body: `<p>${esc(row.body).replace(/\n/g, '<br />')}</p>\n`,
    'm.mentions': {},
  };
  const rel = replyRelOf(row);
  if (rel) content['m.relates_to'] = rel;
  return content;
}

/**
 * 引用回复的关系体。
 *
 * 只放 `m.relates_to.m.in_reply_to`，**不塞 body fallback**（`> <@user> 原文`）：
 * 那条 fallback 必须占 body 开头，会顶掉 `[ID:]` 协议头 —— 对方拿不到昵称头像，
 * 比「看不到引用」严重得多。听雨那边自己发的回复也只有 relates_to、没有 fallback，
 * 说明读的就是这个字段。
 *
 * 被引用的事件在我们库里没有 `matrix_event_id`（那条还没出站成功）时返回 null：
 * 不带引用关系，让它退化成一句普通发言，而不是指一个大厅里不存在的事件。
 */
export function replyRelOf(row: BridgeRow): Record<string, unknown> | null {
  const ev = String(row.replyEventId ?? '').trim();
  if (!ev.startsWith('$')) return null;
  return { 'm.in_reply_to': { event_id: ev } };
}

/**
 * URL path 段的严格编码（RFC 3986）。
 *
 * `encodeURIComponent` 会放过 `! ' ( ) *`，而房间 id 恰好是 `!CKQY…` 开头 ——
 * 有的 Matrix 实现（conduit / 某些反代）在 path 里只认 `%21`，不认裸 `!`。
 */
export function pathSeg(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/* ────────────────────────────── 媒体（图片 / 表情） ────────────────────────────── */

/**
 * 表情包的目录、扩展名与**文件名前缀** —— 必须与 `src/lib/emojis.ts` 的 EMOJI_PACKS 一致。
 *
 * `prefix` 是为了少探路：八套包里，除了 noto 是裸名，其余都带 `qq_` / `tieba_` 这类前缀。
 * 没有它就得按顺序 404 八次才轮到对的那一套（每次都是一次真实的 HTTP 请求）。
 */
const EMOJI_PACKS = [
  { base: '/images/emoji/noto', ext: '.webp', prefix: '' },
  { base: '/images/emoji/alus', ext: '.png', prefix: 'alus_' },
  { base: '/images/emoji/bilibili', ext: '.png', prefix: 'bb_' },
  { base: '/images/emoji/qq', ext: '.gif', prefix: 'qq_' },
  { base: '/images/emoji/tieba', ext: '.png', prefix: 'tieba_' },
  { base: '/images/emoji/coolapk', ext: '.png', prefix: 'coolapk_' },
  { base: '/images/emoji/hi3', ext: '.webp', prefix: 'hi3_' },
  { base: '/images/emoji/douyin', ext: '.png', prefix: 'douyin_' },
] as const;

/** 整条正文只有一个表情：`:[rofl]` 或 `:rofl`（richText 两种写法都认） */
const ONLY_EMOJI = /^:\[?([a-z0-9_]{1,40})\]?$/i;

/** 解码库里存的 base64 图片（0029 的注释：`data` 实际是 base64 文本，不是 BLOB） */
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 上传到对方的 media 仓库，拿 `mxc://` —— 对方客户端只认这个，直链 https 多数实现不渲染 */
export async function uploadToMatrix(
  cfg: BridgeCfg,
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<{ mxc: string; err: string | null }> {
  try {
    const res = await fetch(
      `${cfg.hs}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.token}`, 'content-type': mime },
        body: bytes as unknown as BodyInit,
        signal: AbortSignal.timeout(25_000),
      },
    );
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).slice(0, 160);
      return { mxc: '', err: `upload ${res.status} ${t}` };
    }
    const d = (await res.json().catch(() => ({}))) as { content_uri?: string };
    if (!d.content_uri) return { mxc: '', err: 'upload 没有 content_uri' };
    return { mxc: d.content_uri, err: null };
  } catch (err) {
    return { mxc: '', err: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 图片消息的 content。
 *
 * 与文字不同，`m.image` **没有正文协议头**（body 是文件名/说明），所以这里反而要带
 * `org.tea-room.bridge` —— 不带的话对方连昵称都拿不到，只能显示共享账号自己的名字。
 * 头像仍然拿不到（v1 没有头像字段），对方会用成员资料，这是媒体这条路的已知代价。
 */
export function imageContentOf(
  cfg: BridgeCfg,
  row: BridgeRow,
  mxc: string,
  info: { mime: string; w: number | null; h: number | null; size: number; name: string },
): Record<string, unknown> {
  const text = (row.body || '').trim() || '图片';
  const content: Record<string, unknown> = {
    msgtype: 'm.image',
    body: info.name || text,
    url: mxc,
    info: {
      mimetype: info.mime,
      w: info.w ?? undefined,
      h: info.h ?? undefined,
      size: info.size,
    },
    'org.tea-room.bridge': {
      version: 1,
      site: cfg.site,
      actor: { id: `qingwu-u${row.accountId}`, nick: signOf(row.nick) },
      text,
    },
  };
  const rel = replyRelOf(row);
  if (rel) content['m.relates_to'] = rel;
  return content;
}

/**
 * 找表情图。
 *
 * 目录/扩展名是固定的，但 key 属于哪一套得猜：带 `qq_` / `hi3_` 这类前缀的直接命中，
 * noto 那套是裸名。所以先按前缀分两组，命中的包排前面，其余兜底 ——
 * 正常情况一次请求就拿到，最坏情况才顺序试完八套（打的是自己站，几十毫秒）。
 */
async function fetchEmoji(site: string, key: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const base = site.replace(/\/+$/, '');
  const ordered = [
    ...EMOJI_PACKS.filter((p) => p.prefix && key.startsWith(p.prefix)),
    ...EMOJI_PACKS.filter((p) => !(p.prefix && key.startsWith(p.prefix))),
  ];
  for (const p of ordered) {
    const u = `${base}${p.base}/${encodeURIComponent(key)}${p.ext}`;
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) {
        console.warn(`[bridge] 表情 content-type 不是图片：${u} → ${ct}`);
        continue;
      }
      return { bytes: new Uint8Array(await res.arrayBuffer()), mime: ct };
    } catch (err) {
      console.error(`[bridge] 取表情失败：${u} →`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

/**
 * 投递一条。返回 `{err:null, eventId}` 表示成功，否则 err 是失败原因（写进 last_error）。
 *
 * Matrix 的 `PUT /rooms/{id}/send/{type}/{txnId}` 是幂等的（同一个 txnId 重复 PUT
 * 只会产生一条事件），所以超时后重试是安全的 —— 不用自己判「到底发出去没有」。
 * 响应里的 `event_id` 要留下来：那是后面接已读回执（m.receipt）的唯一钥匙。
 */
export async function deliverToMatrix(
  cfg: BridgeCfg,
  row: BridgeRow,
): Promise<{ err: string | null; eventId?: string }> {
  return deliverContent(cfg, bridgeContentOf(row), row.txn);
}

/** 发任意 content（文字 / 图片共用同一套重试与 event_id 回收） */
export async function deliverContent(
  cfg: BridgeCfg,
  content: Record<string, unknown>,
  txn: string,
): Promise<{ err: string | null; eventId?: string }> {
  const url =
    `${cfg.hs}/_matrix/client/v3/rooms/${pathSeg(cfg.room)}` +
    `/send/m.room.message/${pathSeg(txn)}`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(content),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { event_id?: string };
      return { err: null, eventId: data.event_id };
    }
    const text = (await res.text().catch(() => '')).slice(0, 200);
    // 4xx 里除了 429 基本是「发了也没用」（房间没了 / token 失效），重试别太多轮
    return { err: `${res.status} ${text}` };
  } catch (err) {
    return { err: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 撤回大厅里的那一条（redact）。
 *
 * 只有出站成功过的消息才有 `matrix_event_id` —— 那是唯一能把「我们库里第几条」
 * 和「大厅里哪个事件」对上号的钥匙。还在队列里没发出去的，由 `queueRedact()` 直接销账。
 *
 * 返回 null 表示成功；否则是失败原因（同样按 chat_outbox 的退避重试）。
 */
export async function redactOnMatrix(cfg: BridgeCfg, eventId: string, txn: string): Promise<string | null> {
  const url =
    `${cfg.hs}/_matrix/client/v3/rooms/${pathSeg(cfg.room)}` +
    `/redact/${pathSeg(eventId)}/${pathSeg(txn)}`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      // reason 会显示在 Matrix 客户端里，别写内部术语
      body: JSON.stringify({ reason: '作者撤回了这条消息' }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return null;
    const text = (await res.text().catch(() => '')).slice(0, 200);
    return `${res.status} ${text}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * 撤回时排一条 redact 任务。
 *
 * 两种情况分开处理：
 * - **还没发出去**（`matrix_event_id` 为空）：直接从队列里删掉那条 send —— 大厅里
 *   从没出现过，再 redact 就是打一个不存在的事件；
 * - **已经发出去了**：入队 `op='redact'`，由 flush 按同样的平滑节奏去撤。
 *
 * 调用点是「作者撤回」和「站长/AI 收走」——凡是不该继续留在大厅的都要走这儿。
 */
export async function queueRedact(env: Env, messageId: number): Promise<void> {
  if (!bridgeOf(env)) return;

  const row = await env.DB.prepare(
    `SELECT matrix_event_id AS ev FROM chat_messages WHERE id = ?`,
  )
    .bind(messageId)
    .first<{ ev: string | null }>();

  if (!row?.ev) {
    await env.DB.prepare(
      `DELETE FROM chat_outbox WHERE message_id = ? AND status = 'queued'`,
    )
      .bind(messageId)
      .run();
    return;
  }

  // 已经排过 redact 就不用重复排（连点两下撤回、或者撤回后又删）
  const dup = await env.DB.prepare(
    `SELECT id FROM chat_outbox WHERE message_id = ? AND op = 'redact' AND status IN ('queued','sending','done')`,
  )
    .bind(messageId)
    .first<{ id: number }>();
  if (dup) return;

  const now = Date.now();
  const tail = await env.DB.prepare(
    `SELECT MAX(next_at) AS t FROM chat_outbox WHERE status IN ('queued', 'sending')`,
  ).first<{ t: number | null }>();
  const floor = Number(tail?.t ?? 0) > now ? Number(tail!.t) : now;
  const nextAt = floor + (floor === now ? 0 : GAP_MS);

  await env.DB.prepare(
    `INSERT INTO chat_outbox (message_id, op, txn_id, status, tries, next_at, created_at)
     VALUES (?, 'redact', ?, 'queued', 0, ?, ?)`,
  )
    .bind(messageId, `qingwu-r-${messageId}-${rand(6)}`, nextAt, now)
    .run();
}

type SendResult = { err: string | null; eventId?: string; skip?: boolean };

type MediaRow = {
  kind: string;
  mime: string;
  bytes: number;
  data: string;
  width: number | null;
  height: number | null;
  url: string | null;
  filename: string | null;
};

/**
 * 把一条**图片消息**送到大厅。
 *
 * 三步：从库里（或 R2）取字节 → 上传到对方的 media 仓库换 `mxc://` → 发 `m.image`。
 * 为什么不直接把 `img.qingwu.ink/chat/xxx.png` 当 `url` 发：Matrix 规范里 `url` 只认
 * `mxc://`，多数客户端不会去拉 https 直链，发了等于一张空白。
 */
async function deliverImage(
  env: Env,
  cfg: BridgeCfg,
  row: BridgeRow,
  imageId: number | null,
): Promise<SendResult> {
  if (!imageId) return { err: null, skip: true };

  const media = await env.DB.prepare(
    `SELECT kind, mime, bytes, data, width, height, url, filename FROM chat_media WHERE id = ?`,
  )
    .bind(imageId)
    .first<MediaRow>();
  if (!media) return { err: null, skip: true };

  // 取字节：R2 的 https 直链优先，早期存库的走 base64
  let bytes: Uint8Array | null = null;
  let mime = media.mime || 'application/octet-stream';
  if (media.url) {
    const u = /^https?:\/\//i.test(media.url) ? media.url : `${cfg.site.replace(/\/+$/, '')}${media.url}`;
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(12_000) });
      if (res.ok) {
        bytes = new Uint8Array(await res.arrayBuffer());
        mime = res.headers.get('content-type') || mime;
      }
    } catch {
      /* 落到 base64 那一路 */
    }
  }
  if (!bytes && media.data) {
    try {
      bytes = fromBase64(media.data);
    } catch {
      bytes = null;
    }
  }
  if (!bytes || bytes.length === 0) return { err: null, skip: true };

  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
  const name = media.filename || `qingwu-${row.accountId}-${Date.now()}.${ext}`;
  const up = await uploadToMatrix(cfg, bytes, mime, name);
  if (up.err) return { err: `图片上传失败：${up.err}` };

  return deliverContent(
    cfg,
    imageContentOf(cfg, row, up.mxc, {
      mime,
      w: media.width,
      h: media.height,
      size: media.bytes || bytes.length,
      name,
    }),
    row.txn,
  );
}

/**
 * 整条消息只有一个表情时，改发 `m.image`。
 *
 * 站内表情是 `:[key]` 文本，靠前端渲染成图；对方不认识这个语法，直接发过去就是
 * 一串 `:[bb_doge]`。所以这里把 token 换成真正的图（先上传到对方 media），
 * 正文 `body` 仍留 token —— 参考 lengxiqwq 的做法，对方能看出这是表情而不是普通图片。
 *
 * 返回 `null` 表示「不是表情 / 找不到图」，调用方按普通文字发。
 */
async function deliverEmoji(
  cfg: BridgeCfg,
  row: BridgeRow,
  key: string,
): Promise<SendResult | null> {
  const img = await fetchEmoji(cfg.assets, key);
  if (!img) return null;

  const ext = img.mime.includes('webp') ? 'webp' : 'png';
  const up = await uploadToMatrix(cfg, img.bytes, img.mime, `${key}.${ext}`);
  if (up.err) return { err: `表情上传失败：${up.err}` };

  const token = row.body.trim();
  const content: Record<string, unknown> = {
    msgtype: 'm.image',
    body: token,
    url: up.mxc,
    info: { mimetype: img.mime, size: img.bytes.length },
    'org.tea-room.bridge': {
      version: 1,
      site: cfg.site,
      actor: { id: `qingwu-u${row.accountId}`, nick: signOf(row.nick) },
      text: token,
    },
  };
  const rel = replyRelOf(row);
  if (rel) content['m.relates_to'] = rel;

  return deliverContent(cfg, content, row.txn);
}

/**
 * 补发队列（scheduled 每分钟一次；发送成功时也会立刻催一次）。
 *
 * 三支队伍走同一个队列，按 `op` / `kind` 分流：
 * - `redact`：只有确实出站过的才撤；
 * - `send` + `text`：仍是 visible 才发；整条是一个表情就转成图；
 * - `send` + `image`：取字节 → 上对方 media → 发 `m.image`。
 */
export async function flushBridge(env: Env, limit = BATCH): Promise<{ sent: number; dropped: number; failed: number }> {
  const cfg = bridgeOf(env);
  if (!cfg) return { sent: 0, dropped: 0, failed: 0 };

  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT o.id AS oid, o.op AS op, o.txn_id AS txn, o.tries AS tries,
            m.id AS mid, m.body AS body, m.kind AS kind, m.status AS status,
            m.account_id AS account_id, m.matrix_event_id AS ev, m.image_id AS image_id,
            q.matrix_event_id AS reply_ev,
            a.display_name AS nick, a.avatar_url AS avatar, a.email AS email
       FROM chat_outbox o
       JOIN chat_messages m ON m.id = o.message_id
       LEFT JOIN accounts a ON a.id = m.account_id
       /* 被引用的那条：只有它已经出站过（有 matrix_event_id）才谈得上引用 */
       LEFT JOIN chat_messages q ON q.id = m.reply_to_id
      WHERE o.status = 'queued' AND o.next_at <= ?
      ORDER BY o.id
      LIMIT ?`,
  )
    .bind(now, limit)
    .all();

  const list = (rows.results ?? []) as {
    oid: number;
    op: string;
    txn: string;
    tries: number;
    mid: number;
    body: string;
    kind: string;
    status: string;
    account_id: number;
    ev: string | null;
    image_id: number | null;
    reply_ev: string | null;
    nick: string | null;
    avatar: string | null;
    email: string | null;
  }[];

  let sent = 0;
  let dropped = 0;
  let failed = 0;

  for (const r of list) {
    // ⚠️ 先用 op 分流，再谈状态：撤回任务对应的消息状态本来就是 recalled/deleted，
    //    不能拿 send 的「必须 visible」去筛它，否则撤回头永远发不出去。
    if (r.op === 'redact') {
      if (!r.ev) {
        // 从没出站过（或者出站失败了）⇒ 大厅里没有这条，任务直接销账
        await env.DB.prepare(`DELETE FROM chat_outbox WHERE id = ?`).bind(r.oid).run();
        dropped += 1;
        continue;
      }

      const claimed = await env.DB.prepare(
        `UPDATE chat_outbox SET status = 'sending' WHERE id = ? AND status = 'queued'`,
      )
        .bind(r.oid)
        .run();
      if (!changed(claimed)) continue;

      const err = await redactOnMatrix(cfg, r.ev, r.txn);
      if (err === null) {
        await env.DB.prepare(`UPDATE chat_outbox SET status = 'done', last_error = NULL WHERE id = ?`)
          .bind(r.oid)
          .run();
        sent += 1;
        continue;
      }

      const tries = r.tries + 1;
      if (tries >= MAX_TRIES) {
        await env.DB.prepare(
          `UPDATE chat_outbox SET status = 'failed', tries = ?, last_error = ? WHERE id = ?`,
        )
          .bind(tries, err.slice(0, 300), r.oid)
          .run();
      } else {
        const backoff = Math.min(20_000 * 2 ** (tries - 1), 600_000);
        await env.DB.prepare(
          `UPDATE chat_outbox SET status = 'queued', tries = ?, next_at = ?, last_error = ? WHERE id = ?`,
        )
          .bind(tries, Date.now() + backoff, err.slice(0, 300), r.oid)
          .run();
      }
      failed += 1;
      continue;
    }

    // 已经不可见 ⇒ 不用发了，直接从队列里去掉
    if (r.status !== 'visible') {
      await env.DB.prepare(`DELETE FROM chat_outbox WHERE id = ?`).bind(r.oid).run();
      dropped += 1;
      continue;
    }
    // 媒体这条只做图片；视频 / 文件 / 语音是后面几步的事，别让它们占着重试次数
    if (r.kind !== 'text' && r.kind !== 'image') {
      await env.DB.prepare(`DELETE FROM chat_outbox WHERE id = ?`).bind(r.oid).run();
      dropped += 1;
      continue;
    }

    // 占位，避免并发两轮同时发同一条（cron 与「发送后立刻催一次」会撞）
    const claimed = await env.DB.prepare(
      `UPDATE chat_outbox SET status = 'sending' WHERE id = ? AND status = 'queued'`,
    )
      .bind(r.oid)
      .run();
    if (!changed(claimed)) continue;

    // 昵称要准：正文协议头的 `[ID:]` 就是它。display_name 为空时别退回邮箱前缀
    // （那等于把邮箱贴到大厅），给个中性兜底。
    const nick = (r.nick || '').trim() || `茶客#${r.account_id}`;
    /**
     * 头像走我们自己的域名（`/api/chat/avatar/u/<id>`），不走 `avatarFromEmail()` 那张：
     * `q.qlogo.cn` 在境外回 400（自家香港机实测），对方加载不了；而且那个 URL 的
     * `dst_uin` 是明文 QQ 号。细节见 `localAvatar.ts`。
     */
    const avatar = publicAvatarUrl(cfg.site, r.account_id);
    const row: BridgeRow = {
      body: r.body,
      nick,
      avatar,
      accountId: r.account_id,
      txn: r.txn,
      // 大厅里被引用的那条；空就表示这条不带引用关系
      replyEventId: r.reply_ev ?? undefined,
    };

    let got: SendResult;
    if (r.kind === 'image') {
      got = await deliverImage(env, cfg, row, r.image_id);
    } else {
      // 整条就是一个表情 ⇒ 转成图；不是表情 / 找不到图就按普通文字发
      const key = ONLY_EMOJI.exec((r.body || '').trim());
      const emoji = key ? await deliverEmoji(cfg, row, key[1]!) : null;
      got = emoji ?? (await deliverToMatrix(cfg, row));
    }

    // 「没什么可发的」（图被清了、库里没有 media 行）—— 删队列，别算失败
    if (got.skip) {
      await env.DB.prepare(`DELETE FROM chat_outbox WHERE id = ?`).bind(r.oid).run();
      dropped += 1;
      continue;
    }

    if (got.err === null) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE chat_outbox SET status = 'done', last_error = NULL WHERE id = ?`).bind(r.oid),
        // matrix_event_id 是已读回执的钥匙：/sync 回来的 m.receipt 按 event id 指认
        env.DB.prepare(`UPDATE chat_messages SET matrix_txn_id = ?, matrix_event_id = ? WHERE id = ?`).bind(
          r.txn,
          got.eventId ?? null,
          r.mid,
        ),
      ]);
      sent += 1;
      continue;
    }

    const err = got.err;

    const tries = r.tries + 1;
    if (tries >= MAX_TRIES) {
      await env.DB.prepare(
        `UPDATE chat_outbox SET status = 'failed', tries = ?, last_error = ? WHERE id = ?`,
      )
        .bind(tries, err.slice(0, 300), r.oid)
        .run();
    } else {
      // 20s → 40s → 80s → … 封顶 10 分钟
      const backoff = Math.min(20_000 * 2 ** (tries - 1), 600_000);
      await env.DB.prepare(
        `UPDATE chat_outbox SET status = 'queued', tries = ?, next_at = ?, last_error = ? WHERE id = ?`,
      )
        .bind(tries, Date.now() + backoff, err.slice(0, 300), r.oid)
        .run();
    }
    failed += 1;
  }

  return { sent, dropped, failed };
}

/** D1 的 run() 返回 meta.changes；用它判断「这一行是不是我抢到的」 */
function changed(res: { meta?: { changes?: number } } | undefined | null): boolean {
  return Number(res?.meta?.changes ?? 0) > 0;
}
