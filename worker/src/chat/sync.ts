/**
 * 茶室互联 · 入站（matrix.rainzt.cn 的「大厅」 → 清吾长亭）
 *
 * 方案 §46.5 第 3 步。出站见 `bridge.ts`，这里只管把**别人的新消息**拉回来。
 *
 * ## 三条硬约束（对方提的，也是我们自己的要求）
 *
 * 1. **旧历史不回灌**：第一次 sync 只记游标（`next_batch`），一条都不入库。
 *    否则一接上就往长亭里倒几百条大厅旧话，看着像清吾被灌了。
 * 2. **去重靠 `matrix_event_id`**（0026 建了唯一索引）：/sync 的游标抖动、
 *    重试、多实例抢跑都可能让同一个事件来两次，插入冲突就当已处理。
 * 3. **自己的回声要丢掉**：我们 PUT 出去的事件 Synapse 也会 /sync 回来，
 *    那些在本地本来就是 `origin='local'` 的消息，再插一条 remote 就重复了。
 *    判据是 `unsigned.transaction_id` 的 `qingwu-` 前缀（出站 txn 的命名规则）。
 *
 * ## 另一半：社交信息
 *
 * - **头像与昵称**：多数站的 body 不带 `[ID:];[URL:]` 协议头，只能靠 Matrix 成员资料补。
 *   按 sender 缓存 24h（`chat_remote_profiles`），头像走本 worker 的 `/chat/avatar/:sender`
 *   代理 —— 对方启用了 MSC3916 的认证媒体，`<img>` 带不了 Authorization 头。
 * - **已读**：我们出站的每条都存了 `matrix_event_id`；/sync 的 ephemeral 里有 `m.receipt`，
 *   把直接指到这条消息的 `m.read` 人数写进 `chat_messages.remote_reads`（只增不减）。
 * - **人数**：`joined_members` 的数量存进 `chat_sync.remote_members`，侧栏显示「大厅 N 人」。
 */
import type { Env } from '../types';
import { bridgeOf, pathSeg, type BridgeCfg } from './bridge';

/** 投递一次最多入库多少条 —— 大厅很热闹，一轮灌太多会顶到 D1 的写上限 */
const MAX_INSERT = 30;

/** 抢锁时长：防止 cron 与手动触发撞在一起，同一批事件插两次 */
const LOCK_MS = 45_000;

/** 资料缓存多久过期（对方改昵称/头像后，一天内会跟上） */
const PROFILE_TTL = 24 * 60 * 60 * 1000;

/**
 * 「站内有人」的判定窗口。
 *
 * 必须和 `messages.ts` 的 `ONLINE_WINDOW`（5 分钟）一致 —— 侧栏「此刻在长亭 N 人」
 * 就是按它算的。这里如果用更短的窗口，就会出现「侧栏说有人、大厅里我们却显示离线」
 * 这种自相矛盾的画面。
 */
const LOCAL_ONLINE_WINDOW = 5 * 60 * 1000;

/**
 * 站内此刻有没有人。
 *
 * 和侧栏同源（`chat_presence`），不是看「有没有人在轮询」——
 * 后者会把访客也算上，而且 cron 那条路径根本没人轮询。
 *
 * 查不出来时按「有人」处理：宁可让转发账号显示在线，也别把一个正热闹的屋子标成离线。
 */
async function hasLocalVisitors(env: Env, now: number): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM chat_presence WHERE last_seen > ?`)
    .bind(now - LOCAL_ONLINE_WINDOW)
    .first<{ n: number }>()
    .catch(() => null);
  return r ? Number(r.n) > 0 : true;
}

type SyncEvent = {
  type?: string;
  event_id?: string;
  sender?: string;
  origin_server_ts?: number;
  unsigned?: { transaction_id?: string };
  content?: Record<string, unknown>;
};

/** /sync 的过滤：只要目标房间，不要全部房间的状态 */
function filterOf(room: string): string {
  return JSON.stringify({
    room: { rooms: [room], timeline: { limit: 50 }, ephemeral: { limit: 50 } },
    presence: { not_types: ['*'] },
    account_data: { not_types: ['*'] },
  });
}

/** `[ID:qingwu-u12];[URL:https://…]` 这种协议头，返回两段 */
export function parseHead(line: string): { id: string; avatar: string } {
  const id = /\[ID:([^\]]*)\]/.exec(line)?.[1] ?? '';
  const avatar = /\[URL:([^\]]*)\]/.exec(line)?.[1] ?? '';
  return { id: id.trim(), avatar: avatar.trim() };
}

export type RemoteParsed = {
  body: string;
  nick: string;
  avatar: string;
  sender: string;
  site: string;
  /** 完整 Matrix 用户 ID —— 补资料、代理头像都要它（`sender` 可能是对方的站内身份键） */
  mxid: string;
  eventId: string;
  ts: number;
  /** text | image —— 媒体这条先只做图片 */
  kind: 'text' | 'image';
  /** kind='image' 时的 `mxc://…` */
  mxc?: string;
  mime?: string;
  w?: number | null;
  h?: number | null;
  size?: number | null;
  /**
   * 这条消息回复（引用）了哪条 Matrix 事件。
   *
   * 入站一直没接这个：大厅里别人「引用回复」时，我们这边只剩一句孤零零的正文，
   * 读起来像凭空插话。落库时按 event_id 换成我们的 `chat_messages.id` 存进
   * `reply_to_id`，前端那套引用块（本站消息一直在用）就自动生效了。
   */
  replyEventId?: string;
};

/**
 * 把一个 Matrix 事件解析成我们要存的样子（纯函数，好单测）。
 *
 * 优先读结构化的 `org.tea-room.bridge`（rainzt 用这个）；读不到就退回 body：
 * 首行是协议头就剥掉，那时头像也只能从首行拿 —— 结构化里没有头像字段。
 * 两样都没有时，头像/昵称由 `resolveProfile()` 去 Matrix 成员资料里补。
 */
/**
 * Element 那一类客户端发「富回复」时，会把被引用的原文塞进 body 开头：
 *
 *   > <@qiumonster:chat.gbk.in> 嗯嗯，不做点歌台也可以正常播放的
 *   你的那个项目倒是可以和mineradio结合。
 *
 * 那是引用不是正文，原样收下来我们这边会多出一段「> <@…>」的怪东西。
 * 引用关系本来就在 `m.relates_to` 里，所以这段整块剥掉（全剥完没正文时保留原样）。
 */
function stripReplyPrefix(raw: string): string {
  const ls = raw.split('\n');
  if (!/^>\s*<@[^>]+>/.test(ls[0] ?? '')) return raw;
  let i = 0;
  while (i < ls.length && /^>/.test(ls[i]!)) i += 1;
  if (i < ls.length && !ls[i]!.trim()) i += 1;
  const rest = ls.slice(i).join('\n').trim();
  return rest || raw.trim();
}

export function parseRemoteEvent(ev: SyncEvent): RemoteParsed | null {
  if (!ev.event_id || !ev.sender) return null;

  /**
   * 除了 `m.room.message`，还要收 **`m.sticker`**。
   *
   * Matrix 把贴纸单独定义成一个事件类型（不是 `m.room.message` + msgtype），
   * 听雨那边的表情包走的就是它 —— 只在 `m.room.message` 上做判断的话，
   * 大厅里所有表情在长亭里都会凭空消失（站长报的就是这个）。
   * 结构上它和 `m.image` 一样：`body` + `url` + `info`。
   */
  const isSticker = ev.type === 'm.sticker';
  if (ev.type !== 'm.room.message' && !isSticker) return null;

  const c = (ev.content ?? {}) as Record<string, unknown>;

  const isImage = isSticker || c.msgtype === 'm.image';
  if (!isImage && c.msgtype !== 'm.text') return null; // 视频 / 文件 / 语音是下一步

  const bf = (c['org.tea-room.bridge'] ?? {}) as {
    actor?: { id?: string; nick?: string };
    site?: string;
    text?: string;
  };

  const rawBody = stripReplyPrefix(typeof c.body === 'string' ? c.body : '');
  const lines = rawBody.split('\n');
  const head = lines.length > 1 ? parseHead(lines[0]!) : { id: '', avatar: '' };
  // 首行是协议头就剥掉；不是就当正文的一部分
  const looksLikeHead =
    lines.length > 1 && (/\[ID:[^\]]*\]/.test(lines[0]!) || /\[URL:[^\]]*\]/.test(lines[0]!));
  const bodyFromRaw = looksLikeHead ? lines.slice(1).join('\n') : rawBody;

  let body = (typeof bf.text === 'string' && bf.text.trim() ? bf.text : bodyFromRaw).trim();
  // 图片消息的 body 是文件名/说明，可能整条为空 —— 不能因此丢掉一条图
  if (isImage && !body) body = '图片';
  if (!body) return null;
  // 对方的表情 token（`:[miku_漂浮]:`）或裸文件名挂在图下面只会是一行乱码 —— 不显示
  if (isImage && (/^:\[?[^\]\s]{1,40}\]?:$/.test(body) || /\.(webp|png|jpe?g|gif)$/i.test(body))) {
    body = '';
  }
  // 贴纸的 body 是贴纸名（「听雨茶室表情」这类），对读者没意义 —— 纯图更好看
  if (isSticker) body = '';

  // 图片只认 `mxc://`：对方若发的是 https 直链，多半是自家 CDN，我们代理不了也没必要伪造
  const mxc = isImage && typeof c.url === 'string' ? c.url.trim() : '';
  if (isImage && !/^mxc:\/\//.test(mxc)) return null;
  const info = (c.info ?? {}) as {
    mimetype?: string;
    w?: number;
    h?: number;
    size?: number;
  };

  // 昵称：结构化优先，其次 `@nick:server` 的 localpart（资料补全会再盖一层）
  const nick =
    (typeof bf.actor?.nick === 'string' && bf.actor.nick.trim()) ||
    ev.sender.replace(/^@/, '').split(':')[0] ||
    '远方的茶客';

  // 站点：结构化优先；没有就退到「发信人所在服务器的域名」—— 比空着强
  const site =
    (typeof bf.site === 'string' && bf.site.trim()) ||
    (ev.sender.includes(':') ? `https://${ev.sender.split(':')[1]}` : '');

  /**
   * 回复关系，两种写法都认：
   * · v1.1 起是 `content['m.relates_to']['m.in_reply_to'].event_id`（现在的客户端都用这个）
   * · 更早的是顶层 `content['m.in_reply_to'].event_id`
   */
  const rel = (c['m.relates_to'] ?? {}) as { 'm.in_reply_to'?: { event_id?: string } };
  const legacyRel = (c['m.in_reply_to'] ?? {}) as { event_id?: string };
  const replyEventId =
    (typeof rel['m.in_reply_to']?.event_id === 'string' ? rel['m.in_reply_to']!.event_id!.trim() : '') ||
    (typeof legacyRel.event_id === 'string' ? legacyRel.event_id.trim() : '');

  return {
    // 结构化里的 actor.id 是对方站内的身份键（如 rainzt 的 uuid），比完整 mxid 更有用
    sender: (typeof bf.actor?.id === 'string' && bf.actor.id.trim()) || ev.sender,
    mxid: ev.sender,
    nick,
    avatar: head.avatar,
    site,
    body,
    eventId: ev.event_id,
    ts: Number(ev.origin_server_ts) || Date.now(),
    kind: isImage ? 'image' : 'text',
    mxc: mxc || undefined,
    mime: typeof info.mimetype === 'string' ? info.mimetype : undefined,
    w: typeof info.w === 'number' ? info.w : null,
    h: typeof info.h === 'number' ? info.h : null,
    size: typeof info.size === 'number' ? info.size : null,
    replyEventId: replyEventId || undefined,
  };
}

/** 自己的出站回声：txn 是我们 `qingwu-<消息id>-<随机>` 的命名 */
function isOwnEcho(ev: SyncEvent): boolean {
  const txn = ev.unsigned?.transaction_id;
  return typeof txn === 'string' && txn.startsWith('qingwu-');
}

/**
 * 处理大厅里的撤回（`m.room.redaction`）。
 *
 * 两种写法都要认：v1–v10 把 `redacts` 放在事件顶层，v11 起挪进了 `content.redacts`。
 * 我们自己撤的那条也会 sync 回来（txn 是 `qingwu-r-…`），跳过 —— 本地状态早就是 recalled 了。
 */
async function applyRedactions(env: Env, events: SyncEvent[]): Promise<number> {
  let n = 0;
  for (const ev of events) {
    if (ev.type !== 'm.room.redaction') continue;
    if (isOwnEcho(ev)) continue;

    const top = (ev as { redacts?: unknown }).redacts;
    const inner = (ev.content as { redacts?: unknown } | undefined)?.redacts;
    const target = typeof top === 'string' ? top : typeof inner === 'string' ? inner : '';
    if (!target) continue;

    const res = await env.DB.prepare(
      `UPDATE chat_messages SET status = 'recalled', updated_at = ?
        WHERE matrix_event_id = ? AND origin = 'remote' AND status IN ('visible', 'pending')`,
    )
      .bind(Date.now(), target)
      .run();
    if (Number(res.meta?.changes ?? 0) > 0) n += 1;
  }
  return n;
}

/**
 * 处理大厅里的表情回应（`m.reaction`）。
 *
 * 结构是 `m.relates_to = { rel_type: 'm.annotation', event_id: 原消息, key: '🔥' }`。
 * 先按 `event_id` 反查本地消息 —— 不是每条都能对上（可能我们没收到那条），对不上就跳过。
 *
 * 不回写 `chat_reactions`：那张表用我们的 account_id 当身份，大厅来的人没有 id，
 * 塞 0 会让「甲点过」变成「乙也点过」。单独一张 `chat_remote_reactions`（0039）。
 */
async function applyReactions(env: Env, events: SyncEvent[]): Promise<number> {
  let n = 0;
  for (const ev of events) {
    if (ev.type !== 'm.reaction') continue;
    const rel = (ev.content as { 'm.relates_to'?: Record<string, unknown> } | undefined)?.[
      'm.relates_to'
    ] as { rel_type?: string; event_id?: string; key?: unknown } | undefined;
    if (!rel || rel.rel_type !== 'm.annotation') continue;

    const target = typeof rel.event_id === 'string' ? rel.event_id : '';
    const key = typeof rel.key === 'string' ? rel.key.trim() : '';
    if (!target || !key || !ev.sender) continue;

    const row = await env.DB.prepare(
      `SELECT id FROM chat_messages WHERE matrix_event_id = ?`,
    )
      .bind(target)
      .first<{ id: number }>();
    if (!row) continue;

    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO chat_remote_reactions (message_id, sender, emoji, ts) VALUES (?, ?, ?, ?)`,
    )
      .bind(row.id, ev.sender, key.slice(0, 32), Number(ev.origin_server_ts) || Date.now())
      .run();
    if (Number(res.meta?.changes ?? 0) > 0) n += 1;
  }
  return n;
}

/**
 * 头像代理地址（前端 `<img>` 直接用）。
 *
 * ⚠️ 必须带 `/api` 前缀：worker 内部路由是 `/chat/avatar/:sender`，但对外一律走
 * `/api/*`（nginx 剥掉前缀再转给 8787）。少了这两个字母，浏览器会去请求 nginx 的静态
 * 目录，拿回一个 404 —— 表现就是头像全是灰块。
 */
export function avatarUrlOf(sender: string, size = 96): string {
  return `/api/chat/avatar/${encodeURIComponent(sender)}?s=${size}`;
}

/**
 * 拿某个 Matrix 用户的昵称与头像（带缓存）。
 *
 * 先查 `chat_remote_profiles`；没有就查房间成员状态 `m.room.member`。
 * 头像存的是 `mxc://` 原文，真正取图由 `/chat/avatar/:sender` 代理 —— 之所以不直接把
 * mxc 拼成 http，是因为对方开了 MSC3916 的认证媒体，`<img>` 请求带不了 Authorization。
 */
export async function resolveProfile(
  env: Env,
  cfg: BridgeCfg,
  mxid: string,
): Promise<{ nick: string; mxc: string }> {
  const now = Date.now();
  const cached = await env.DB.prepare(
    `SELECT nick, mxc, fetched_at FROM chat_remote_profiles WHERE sender = ?`,
  )
    .bind(mxid)
    .first<{ nick: string | null; mxc: string | null; fetched_at: number }>();
  if (cached && now - cached.fetched_at < PROFILE_TTL) {
    return { nick: cached.nick || '', mxc: cached.mxc || '' };
  }

  try {
    const res = await fetch(
      `${cfg.hs}/_matrix/client/v3/rooms/${pathSeg(cfg.room)}/state/m.room.member/${pathSeg(mxid)}`,
      { headers: { authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(6000) },
    );
    if (res.ok) {
      const d = (await res.json().catch(() => ({}))) as { displayname?: string; avatar_url?: string };
      const nick = typeof d.displayname === 'string' ? d.displayname.trim() : '';
      const mxc = typeof d.avatar_url === 'string' ? d.avatar_url.trim() : '';
      await env.DB.prepare(
        `INSERT INTO chat_remote_profiles (sender, nick, avatar, mxc, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sender) DO UPDATE SET nick = excluded.nick, avatar = excluded.avatar,
           mxc = excluded.mxc, fetched_at = excluded.fetched_at`,
      )
        .bind(mxid, nick || null, mxc ? avatarUrlOf(mxid) : null, mxc || null, now)
        .run();
      return { nick, mxc };
    }
  } catch (err) {
    console.error('[bridge] 取成员资料失败:', err instanceof Error ? err.message : err);
  }
  return { nick: '', mxc: '' };
}

/**
 * 头像代理：把 `mxc://server/media` 换成真正能显示的图。
 *
 * 先试 MSC3916 的认证媒体端点（新版 Synapse 只认这个），404/400 再退到旧的
 * `/_matrix/media/v3`。两者都要求 token，所以必须由 worker 中转，不能把 URL 直接丢给前端。
 */
export async function getRemoteAvatar(request: Request, env: Env): Promise<Response> {
  const cfg = bridgeOf(env);
  if (!cfg) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const mxid = decodeURIComponent(url.pathname.replace(/^\/chat\/avatar\//, ''));
  const size = Math.min(Math.max(Number(url.searchParams.get('s') || 96) || 96, 32), 256);
  if (!mxid) return new Response(null, { status: 404 });

  const { mxc } = await resolveProfile(env, cfg, mxid);
  const m = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxc);
  if (!m) return transparent1px();

  const [, server, media] = m;
  const qs = `width=${size}&height=${size}&method=crop`;
  const tries = [
    `${cfg.hs}/_matrix/client/v1/media/thumbnail/${pathSeg(server!)}/${pathSeg(media!)}?${qs}`,
    `${cfg.hs}/_matrix/media/v3/thumbnail/${pathSeg(server!)}/${pathSeg(media!)}?${qs}`,
  ];

  for (const u of tries) {
    try {
      const res = await fetch(u, {
        headers: { authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      return new Response(res.body, {
        status: 200,
        headers: {
          'content-type': res.headers.get('content-type') || 'image/jpeg',
          // 浏览器缓存一天；对方换头像时 profile 缓存过期后会拿到新地址（URL 不变但服务端会重新取）
          'cache-control': 'public, max-age=86400',
        },
      });
    } catch {
      /* 试下一个端点 */
    }
  }
  return transparent1px();
}

/** 拿不到头像时回一张透明图，前端不会出现破图图标 */
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

/**
 * 入站图片的地址：`/api/chat/mxc/<base64url(mxc://…)>`。
 *
 * 为什么不是直接把 mxc 塞进路径（`/api/chat/mxc/mxc%3A%2F%2F…`）：
 * **nginx 默认 `merge_slashes on`**，会把编码后的 `%2F%2F` 还原成 `//` 再合并，
 * 于是 worker 收到的是 `/chat/mxc/mxc:/matrix…` —— 少一个斜杠，正则匹配不上，
 * 表现就是「所有入站图片都变成 1px 透明图」。base64url 里没有 `/`，稳。
 *
 * 和头像同一个道理的另一半：对方开了认证媒体（MSC3916），`<img>` 带不了
 * Authorization，只能由 worker 取回来转手。
 */
export function remoteMediaUrl(mxc: string): string {
  const b64 = btoa(mxc).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `/api/chat/mxc/${b64}`;
}

function unb64url(s: string): string {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  } catch {
    return '';
  }
}

/**
 * 把 `mxc://` 转成真正的图。
 *
 * 请求主机**永远是 `cfg.hs`**（我们登录的那台），路径里的 server 是媒体所属的
 * 联邦服务器 —— Synapse 会自己去对方那里取（`/_matrix/media/v3/download/<server>/<id>`）。
 * 所以不能要求 `server === hs`：大厅里别人站的图，mxc 就长在对方域名下
 * （实测 lengxiqwq 的是 `mxc://matrix.lengxiqwq.com/…`）。
 */
export async function getRemoteMedia(request: Request, env: Env): Promise<Response> {
  const cfg = bridgeOf(env);
  if (!cfg) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const token = url.pathname.replace(/^\/chat\/mxc\//, '').replace(/\/+$/, '');

  // 旧格式（直接 URL 编码的 mxc）兼容一下，免得已入库的几条图打不开
  const raw = /^mxc%3A|^mxc:/.test(token) ? decodeURIComponent(token) : unb64url(token);
  const m = /^mxc:\/\/([^/]+)\/(.+)$/.exec(raw);
  if (!m) return transparent1px();

  const [, server, media] = m;
  if (!server || !media || server.length > 255 || media.length > 512) return transparent1px();

  const tries = [
    `${cfg.hs}/_matrix/client/v1/media/download/${pathSeg(server!)}/${pathSeg(media!)}`,
    `${cfg.hs}/_matrix/media/v3/download/${pathSeg(server!)}/${pathSeg(media!)}`,
  ];

  for (const u of tries) {
    try {
      const res = await fetch(u, {
        headers: { authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      return new Response(res.body, {
        status: 200,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/octet-stream',
          // 图片内容不变，缓存久一点；对方删了图也只会命中旧缓存，无伤
          'cache-control': 'public, max-age=604800',
        },
      });
    } catch {
      /* 试下一个端点 */
    }
  }
  return transparent1px();
}

/**
 * 拉一次 /sync 并入库。由 scheduled 每分钟调用。
 *
 * 返回值里 `first` 表示这是接上来的第一轮（只记游标，不入库）。
 */
/**
 * 上一次「在线催拉」的时间（模块级，单实例够了）。
 *
 * worker 只有一个进程在跑，用它做节流最简单；多实例时最多是几台各自拉一次，
 * 也不会出问题（`/sync` 的游标本来就能被多方读取）。
 */
let lastEagerPull = 0;

/**
 * 有人在线时催一次入站。
 *
 * cron 的最小粒度是一分钟，而「别人一发我们就要收」要秒级 —— 让 `/chat/poll`
 * 顺手带一下：页面开着时每 2.5 秒一次 `/sync`，人关了页面就回到 cron 兜底。
 *
 * 节流是必要的：长亭可能同时开着好几个页面，每个都 2.5 秒 poll 一次，
 * 不节流就是每秒好几次 `/sync`。2.5 秒正好匹配前端轮询间隔。
 */
export async function pullBridgeIfIdle(env: Env, gapMs = 2500): Promise<void> {
  const now = Date.now();
  if (now - lastEagerPull < gapMs) return;
  lastEagerPull = now;
  await pullBridge(env);
}

export async function pullBridge(
  env: Env,
): Promise<{
  added: number;
  skipped: number;
  first: boolean;
  redacted: number;
  reacted: number;
}> {
  const cfg = bridgeOf(env);
  if (!cfg) return { added: 0, skipped: 0, first: false, redacted: 0, reacted: 0 };

  const now = Date.now();

  // 抢锁：先确保有一行，再 CAS 式地拿到锁
  await env.DB.prepare(
    `INSERT INTO chat_sync (id, room_id, since, lock_until, updated_at)
     VALUES (1, ?, NULL, 0, ?)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(cfg.room, now)
    .run();

  const lock = await env.DB.prepare(
    `UPDATE chat_sync SET lock_until = ?, updated_at = ? WHERE id = 1 AND lock_until < ?`,
  )
    .bind(now + LOCK_MS, now, now)
    .run();
  if (Number(lock.meta?.changes ?? 0) === 0) return { added: 0, skipped: 0, first: false, redacted: 0, reacted: 0 };

  try {
    const row = await env.DB.prepare(`SELECT since, room_id FROM chat_sync WHERE id = 1`).first<{
      since: string | null;
      room_id: string | null;
    }>();
    // 换了房间就该重新对齐游标，别拿旧房间的 since 去问新房间
    const since = row?.room_id === cfg.room ? row?.since : null;

    // 大厅人数：轻量接口，每分钟一次可接受（只有 user_id 列表）
    const members = await countMembers(cfg).catch(() => null);

    const qs = new URLSearchParams({
      timeout: '0',
      filter: filterOf(cfg.room),
      /**
       * 站内没人的时候，顺手把转发账号也标成离线。
       *
       * 为什么必须显式写：`/sync` 不带这个参数时是 `online`，而 cron 每分钟都会拉一次 ——
       * 等于每分钟给 `@qingwuzf` 续一次命，大厅里永远显示「清吾长亭 在线」，
       * 哪怕我们这边一个人都没有。设成 `offline` 之后，最后一个人离开约 5 分钟，
       * 大厅里就会看到它下线。
       *
       * ⚠️ 只影响 presence，**消息照收**：`/sync` 的返回和它无关，
       * 真停了拉取会漏掉离开期间的消息，那是另一回事。
       */
      set_presence: (await hasLocalVisitors(env, now)) ? 'online' : 'offline',
    });
    if (since) qs.set('since', since);

    const res = await fetch(`${cfg.hs}/_matrix/client/v3/sync?${qs.toString()}`, {
      headers: { authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).slice(0, 160);
      console.error(`[bridge] /sync ${res.status}: ${t}`);
      return { added: 0, skipped: 0, first: false, redacted: 0, reacted: 0 };
    }

    const data = (await res.json().catch(() => ({}))) as {
      next_batch?: string;
      rooms?: {
        join?: Record<
          string,
          {
            timeline?: { events?: SyncEvent[] };
            ephemeral?: { events?: { type?: string; content?: Record<string, unknown> }[] };
          }
        >;
      };
    };

    const nextBatch = data.next_batch;
    const joined = data.rooms?.join?.[cfg.room];
    const events = joined?.timeline?.events ?? [];

    // 已读回执：先处理，跟新增无关（只改 remote_reads）
    await applyReceipts(env, joined?.ephemeral?.events ?? []);

    // 第一轮：只记游标，不回灌历史
    if (!since) {
      await env.DB.prepare(
        `UPDATE chat_sync SET room_id = ?, since = ?, lock_until = 0, updated_at = ?,
           remote_members = COALESCE(?, remote_members) WHERE id = 1`,
      )
        .bind(cfg.room, nextBatch ?? null, Date.now(), members)
        .run();
      return { added: 0, skipped: events.length, first: true, redacted: 0, reacted: 0 };
    }

    // 撤回：跟新增分开走 —— 撤回事件本身不是消息，不能被当成「一条空消息」跳过
    const redacted = await applyRedactions(env, events);

    // 表情回应：同样不是消息，单独处理（对不上本地消息的直接跳过）
    const reacted = await applyReactions(env, events);

    let added = 0;
    let skipped = 0;
    let lastEventId = '';

    // 大厅自己的原生用户不该挂「来自 matrix.rainzt.cn」—— 他们本来就是这间屋子的本地人。
    // 只有结构化里明确写了别的站的 site，才算「从别处来」。
    const hsHost = (() => {
      try {
        return new URL(cfg.hs).host;
      } catch {
        return '';
      }
    })();

    // 从旧到新处理；超过 MAX_INSERT 就留到下一轮（游标不前进时会重来）
    const queue = events.filter((e) => !isOwnEcho(e)).slice(-MAX_INSERT);

    for (const ev of queue) {
      const p = parseRemoteEvent(ev);
      if (!p) {
        skipped += 1;
        continue;
      }
      if (hsHost && p.site === `https://${hsHost}`) p.site = '';

      // 昵称与头像**分开补**：只缺头像时不能拿 Matrix 成员资料把已有的昵称盖掉。
      // （第一版写成 `!avatar || !nick …` 合在一起，结果协议头里的「朝朝听雨」
      //   被转发账号自己的 displayname 盖成了 `qingwu`。）
      const localpart = p.mxid.replace(/^@/, '').split(':')[0];
      const needNick = !p.nick || p.nick === localpart;
      const needAvatar = !p.avatar;
      if (needNick || needAvatar) {
        const prof = await resolveProfile(env, cfg, p.mxid);
        if (needNick && prof.nick) p.nick = prof.nick;
        if (needAvatar && prof.mxc) p.avatar = avatarUrlOf(p.mxid);
      }

      /**
       * 引用回复：把 Matrix 的 `event_id` 换成本地行号。
       *
       * 被引用的那条一定比这条早出站/入库，所以这一眼基本都能查到；
       * 查不到（引用的是我们没收到的事件，比如对方站内部消息）就留空，
       * 前端退化成一条普通消息，不会出现空引用块。
       */
      let replyToId: number | null = null;
      if (p.replyEventId) {
        const t = await env.DB.prepare(
          `SELECT id FROM chat_messages WHERE matrix_event_id = ? LIMIT 1`,
        )
          .bind(p.replyEventId)
          .first<{ id: number }>();
        if (t?.id) replyToId = t.id;
      }

      // 图片先落一条 chat_media —— 前端渲染走 `media.url`（我们的 mxc 代理），不存字节
      let mediaId: number | null = null;
      if (p.kind === 'image' && p.mxc) {
        const m = await env.DB.prepare(
          `INSERT INTO chat_media (kind, mime, bytes, data, width, height, duration, account_id, ts, url)
           VALUES ('image', ?, ?, '', ?, ?, NULL, 0, ?, ?)`,
        )
          .bind(p.mime || 'image/*', p.size ?? 0, p.w ?? null, p.h ?? null, p.ts, remoteMediaUrl(p.mxc))
          .run();
        mediaId = Number(m.meta?.last_row_id ?? 0) || null;
      }

      // matrix_event_id 有唯一索引：重复插入会抛，用 OR IGNORE 直接当已处理
      const ins = await env.DB.prepare(
        `INSERT OR IGNORE INTO chat_messages
           (account_id, body, kind, status, ts, updated_at, origin,
            remote_sender, remote_nick, remote_avatar, remote_site, matrix_event_id, image_id, reply_to_id)
         VALUES (NULL, ?, ?, 'visible', ?, ?, 'remote', ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          p.body,
          p.kind,
          p.ts,
          Date.now(),
          p.sender,
          p.nick,
          p.avatar,
          p.site,
          p.eventId,
          mediaId,
          replyToId,
        )
        .run();
      if (Number(ins.meta?.changes ?? 0) > 0) added += 1;
      else {
        // 重复事件：刚为它插的那行 media 是孤儿，删掉（否则要等 7 天清理才回收）
        if (mediaId) await env.DB.prepare(`DELETE FROM chat_media WHERE id = ?`).bind(mediaId).run();
        skipped += 1;
      }
      lastEventId = p.eventId;
    }

    // 我们读过之后给大厅回一个已读回执 —— 不然对面永远不知道清吾这边有人看了
    if (lastEventId) void markRead(cfg, lastEventId);

    await env.DB.prepare(
      `UPDATE chat_sync SET room_id = ?, since = ?, lock_until = 0, updated_at = ?,
         remote_members = COALESCE(?, remote_members) WHERE id = 1`,
    )
      .bind(cfg.room, nextBatch ?? since, Date.now(), members)
      .run();

    return { added, skipped, first: false, redacted, reacted };
  } catch (err) {
    console.error('[bridge] 入站失败:', err instanceof Error ? err.message : err);
    return { added: 0, skipped: 0, first: false, redacted: 0, reacted: 0 };
  } finally {
    // 无论成败都放锁，否则要等 LOCK_MS 自然过期
    await env.DB.prepare(`UPDATE chat_sync SET lock_until = 0 WHERE id = 1`).run().catch(() => {});
  }
}

/** 房间成员数（大厅有多少人） */
async function countMembers(cfg: BridgeCfg): Promise<number | null> {
  const res = await fetch(`${cfg.hs}/_matrix/client/v3/rooms/${pathSeg(cfg.room)}/joined_members`, {
    headers: { authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { joined?: Record<string, unknown> };
  const n = d.joined ? Object.keys(d.joined).length : 0;
  return n > 0 ? n : null;
}

/**
 * 把 `m.receipt` 里的 `m.read` 人数写进 remote_reads（只增不减）。
 *
 * 口径说明：这里统计的是**直接指到这条消息**的已读；读了更晚消息的人也读过它，
 * 但 Matrix 的收据只推送「最后读到哪」，要精确统计得自己维护每人读到的事件序号 —— 
 * 那是另一个量级的事。当前口径只会低估、不会虚高。
 */
async function applyReceipts(
  env: Env,
  events: { type?: string; content?: Record<string, unknown> }[],
): Promise<number> {
  let n = 0;
  for (const ev of events) {
    if (ev.type !== 'm.receipt' || !ev.content) continue;
    for (const [eventId, kinds] of Object.entries(ev.content)) {
      const read = (kinds as Record<string, unknown> | undefined)?.['m.read'];
      if (!read || typeof read !== 'object') continue;
      const readers = Object.keys(read as Record<string, unknown>).length;
      if (readers <= 0) continue;
      const res = await env.DB.prepare(
        `UPDATE chat_messages SET remote_reads = MAX(remote_reads, ?)
          WHERE matrix_event_id = ? AND origin = 'local'`,
      )
        .bind(readers, eventId)
        .run();
      if (Number(res.meta?.changes ?? 0) > 0) n += 1;
    }
  }
  return n;
}

/** 给大厅回一个 m.read 收据（失败无所谓，下次还会补） */
async function markRead(cfg: BridgeCfg, eventId: string): Promise<void> {
  try {
    await fetch(
      `${cfg.hs}/_matrix/client/v3/rooms/${pathSeg(cfg.room)}/receipt/m.read/${pathSeg(eventId)}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch {
    /* 静默 */
  }
}
