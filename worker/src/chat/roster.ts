/**
 * 长亭 · 互联站点名册（吃联邦名单 members.json）
 *
 * 数据源：https://github.com/Jarvis0227/federated-chat 的 `members.json`
 * （各站自己填的：站名、简介、站点地址、聊天室地址、图标、homeserver、主题色）。
 *
 * ## 为什么要换掉「从消息反推 + 抓 title」
 *
 * 老做法（`who.ts` 的 listPeers）有三个天生缺陷：
 *   1. 只列**最近 30 天说过话**的站 —— 安静的站会整块消失，看着像互联断了；
 *   2. 名字靠抓对方首页 `<title>`，又要防 SSRF 又要 cron 慢慢补，第一次见永远是域名；
 *   3. 图标靠友链表匹配，没在友链里填过的站只能退到 `/favicon.ico`。
 * 名册把这三件事一次性解决：站名/图标/链接都是对方自己填的。
 *
 * ## 缓存
 *
 * `who` 是 30 秒一次的热接口，不能每次都去 GitHub。整份 JSON 缓存在 D1 表
 * `chat_roster`（单行），TTL 1 小时；拉取失败时**继续用旧缓存**（哪怕过期），
 * 只有从来没成功过才返回空 —— 那样前端会退回「只有本站」。
 */

import type { Env } from '../types';

const SOURCE =
  'https://raw.githubusercontent.com/Jarvis0227/federated-chat/main/members.json';

/** 缓存保鲜期：名册变化很慢，1 小时足够 */
const TTL = 60 * 60 * 1000;

/** 拉取超时：who 是热接口，宁可这轮用旧缓存也别拖住侧栏 */
const TIMEOUT = 6000;

export interface RosterEntry {
  /** 站点 host（取自 siteUrl），作为并消息统计的 key */
  host: string;
  /** 站名（对方自己填的 siteName） */
  name: string;
  /** 站点地址（点「去看看」跳这里） */
  url: string;
  /** 聊天室地址 */
  chatUrl: string;
  /** 头像/图标 */
  icon: string;
  /** 对方的 homeserver（判断「是不是本站」用） */
  homeserver: string;
  /** 对方填的主题色，前端可以拿去做卡片染色（可选） */
  color: string;
  /** 一句话简介 */
  desc: string;
}

interface RawMember {
  siteName?: string;
  siteDescription?: string;
  siteUrl?: string;
  chatUrl?: string;
  siteIconUrl?: string;
  homeserver?: string;
  color?: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 只留「像 host」的字符串：无协议、无端口、无路径 */
export function hostOfUrl(url: string): string {
  const t = url.trim();
  if (!t) return '';
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).host.toLowerCase();
  } catch {
    return '';
  }
}

function normalize(raw: RawMember[]): RosterEntry[] {
  const out: RosterEntry[] = [];
  for (const m of raw) {
    const name = str(m.siteName);
    const siteUrl = str(m.siteUrl);
    const host = hostOfUrl(siteUrl);
    if (!name || !host) continue;
    out.push({
      host,
      name,
      url: siteUrl,
      chatUrl: str(m.chatUrl),
      icon: str(m.siteIconUrl),
      homeserver: hostOfUrl(str(m.homeserver)) || str(m.homeserver).toLowerCase(),
      color: str(m.color),
      desc: str(m.siteDescription),
    });
  }
  return out;
}

/** 读缓存（不判断新鲜度）；表还没建时返回 null，不抛错 */
async function readCache(env: Env): Promise<{ entries: RosterEntry[]; at: number } | null> {
  try {
    const row = await env.DB.prepare(`SELECT body, fetched_at FROM chat_roster WHERE id = 1`).first<{
      body: string;
      fetched_at: number;
    }>();
    if (!row?.body) return null;
    const parsed = JSON.parse(row.body) as RawMember[];
    if (!Array.isArray(parsed)) return null;
    return { entries: normalize(parsed), at: Number(row.fetched_at ?? 0) };
  } catch (err) {
    console.warn('[roster] 读缓存失败：', err instanceof Error ? err.message : err);
    return null;
  }
}

async function writeCache(env: Env, raw: RawMember[], now: number): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO chat_roster (id, body, fetched_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
    )
      .bind(JSON.stringify(raw), now)
      .run();
  } catch (err) {
    // 缓存写不进去不影响本轮显示
    console.warn('[roster] 写缓存失败：', err instanceof Error ? err.message : err);
  }
}

async function fetchRaw(env: Env): Promise<RawMember[] | null> {
  const url = str(env.ROSTER_URL) || SOURCE;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'qingwu-chat/1.0 (+https://www.qingwu.ink/)' },
      signal: AbortSignal.timeout(TIMEOUT),
      // 走 Cloudflare 的 fetch：带 etag 也没意义，我们自己有 TTL
    });
    if (!res.ok) {
      console.warn(`[roster] 拉名册失败：${res.status}`);
      return null;
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      console.warn('[roster] 名册格式不是数组，忽略');
      return null;
    }
    return data as RawMember[];
  } catch (err) {
    console.warn('[roster] 拉名册异常：', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 拿名册（带缓存）。永不抛错：
 *   · 缓存新鲜 → 直接给；
 *   · 过期 → 拉一次，成功就用新的，失败退回旧的；
 *   · 从没成功过 → 空数组（调用方退回老逻辑）。
 */
export async function getRoster(env: Env, now = Date.now()): Promise<RosterEntry[]> {
  const cached = await readCache(env);
  if (cached && now - cached.at < TTL) return cached.entries;

  const raw = await fetchRaw(env);
  if (raw) {
    await writeCache(env, raw, now);
    return normalize(raw);
  }
  return cached?.entries ?? [];
}
