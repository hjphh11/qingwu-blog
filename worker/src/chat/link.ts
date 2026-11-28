// 长亭 · 链接预览
//
// 一条消息里出现链接时，抓一次它的 Open Graph 信息，在气泡下面显示一张小卡片。
//
// ## 这是全站第一个「按用户给的地址去抓网页」的地方
//
// 也就是说：**任何人都能让服务器去访问任意地址**。这类功能的经典漏洞是 SSRF ——
// 用 `http://127.0.0.1:22`、`http://169.254.169.254/latest/meta-data/`（云元数据）
// 或者内网主机名，借服务器的手去摸它自己碰得到、攻击者碰不到的东西。
//
// worker 里拿不到 DNS 解析结果（fetch 不暴露），所以没法「先解析再判断」。
// 这里的防线是**只信域名，不信地址**：
//   · 协议只允许 http / https；
//   · 端口只允许 80 / 443（内网服务很少长在标准端口上，而正常分享几乎不会带端口）；
//   · **拒绝一切 IP 字面量**（v4 与 v6）—— 正常分享都是域名，IP 只有攻击者在用；
//   · 拒绝 localhost / *.local / *.internal 这类只在局域网有意义的名字；
//   · 拒绝带用户名密码的 URL（`http://user:pass@host` 是常见的绕过写法）；
//   · **自己跟重定向**（`redirect: 'manual'`，最多 3 跳），每一跳都重新过一遍上面的检查
//     —— 让 fetch 自动跳，就等于把「跳去哪儿」交给了对方。
//
// 再加上超时与体积上限：抓不动就放弃，绝不把首屏拖住（它是 `waitUntil` 里的后台活）。
//
// ## 为什么失败也缓存
//
// 一个 403 的站点，每次打开聊天都要白等 4 秒超时；把「试过了，没有」也记一行，
// 24 小时内不再试。过期后重新试一次 —— 对方可能只是当时挂了。

import type { Env } from '../types';

/** 抓取超时：4 秒。超过就不值了 —— 卡片是锦上添花，不该拖住任何东西 */
const FETCH_TIMEOUT = 4000;
/** 只读前 200KB。OG 都在 <head> 里，正常页面 20KB 内就有 */
const MAX_BYTES = 200_000;
/** 最多跟 3 跳 */
const MAX_HOPS = 3;
/** 成功缓存 7 天；失败缓存 24 小时（给挂掉的站点一个重试的机会） */
const TTL_OK = 7 * 24 * 3600 * 1000;
const TTL_FAIL = 24 * 3600 * 1000;

/** 抓取时的 UA：说明自己是谁，也避免被当成爬虫直接 403 */
const UA = 'Mozilla/5.0 (compatible; qingwu-linkbot/1.0; +https://www.qingwu.ink/)';

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string;
  site: string;
}

/**
 * 从一段文字里取第一个 http(s) 链接。
 *
 * 只认 `http://` / `https://` 开头的裸链接 —— 不做「example.com」这种补全，
 * 因为补全规则永远猜不对（是 .com 还是 .ink？是路径还是二级域名？）。
 * 末尾的标点要去掉：中文里一句话常写成「看这个 https://a.com/x。」，
 * 那个「。」不属于 URL。
 */
export function extractUrl(text: string): string {
  const m = /https?:\/\/[^\s<>"'`]+/i.exec(text);
  if (!m) return '';
  // 尾部的标点、右括号、中文标点统统剥掉；括号只剥「没有配对」的那一侧
  let url = m[0].replace(/[.,;:!?。，、；：！？"'）】》\]}>]+$/u, '');
  // `(https://a.com/x)` 这种：尾部右括号剥掉后如果多了个左括号，也去掉
  if (url.endsWith(')') && !url.includes('(')) url = url.slice(0, -1);
  return url.slice(0, 500);
}

/** 这个地址能不能抓。返回规范化的 URL，或 null */
export function safeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // `http://user:pass@host` —— 常见的绕过写法（有些解析器会去连 user 段）
  if (u.username || u.password) return null;

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return null;

  // 只认标准端口。带端口的内网服务很多，而正常分享几乎不会写端口
  if (u.port && u.port !== '80' && u.port !== '443') return null;

  /**
   * IP 字面量**一律**拒绝，公网的也拒。
   *
   * 正常分享都是域名；写 IP 的要么是临时测试地址，要么就是想摸内网
   * （`169.254.169.254` 是云元数据、`127.0.0.1` 是它自己）。
   * 与其维护一份「哪些网段算私有」的清单等着漏，不如整类不碰。
   */
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  if (host.includes(':')) return null;

  // 只在局域网有意义的名字
  if (!host.includes('.')) return null;
  if (/\.(local|localhost|internal|localdomain|intranet|home\.arpa)$/i.test(host)) return null;

  return u;
}

/** 只读前 N 字节就断开 —— 别把一个 50MB 的页面读进来 */
async function readCapped(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      size += value.byteLength;
      if (size >= cap) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* 已经断了 */
    }
  }
  const all = new Uint8Array(Math.min(size, cap));
  let at = 0;
  for (const c of chunks) {
    if (at >= all.length) break;
    const take = Math.min(c.byteLength, all.length - at);
    all.set(c.subarray(0, take), at);
    at += take;
  }
  return new TextDecoder('utf-8').decode(all);
}

/** 抓一个页面，自己跟重定向（每一跳都重新过 safeUrl） */
async function fetchHtml(start: URL): Promise<{ html: string; final: URL } | null> {
  let cur = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetch(cur.toString(), {
        // ⚠️ 关键：不交给 fetch 跟。让它自动跳就等于把目的地交给了对方
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
    } catch {
      return null; // 超时 / DNS / TLS 失败
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      let next: URL | null = null;
      try {
        next = safeUrl(new URL(loc, cur).toString());
      } catch {
        next = null;
      }
      if (!next) return null;
      cur = next;
      continue;
    }

    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    // 只认 HTML：PDF / 图片 / JSON 抓回来也没有 OG
    if (!ct.includes('text/html')) return null;
    return { html: await readCapped(res, MAX_BYTES), final: cur };
  }
  return null;
}

/** HTML 实体解码（只处理最常见的几个：OG 文案里出现 &amp; 很常见） */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)));
}

/** 属性值里可能带 > 或换行，取到匹配的引号为止 */
function attrOf(tag: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : '';
}

/**
 * 解析 OG。刻意不用 HTML 解析器：
 * 一张卡片只需要 <head> 里的几个 meta，引一个解析库要多几十 KB，
 * 而这里能容忍「解析不全」—— 解析不出来就是没有卡片，不是错误。
 */
export function parsePreview(html: string, base: URL): Omit<LinkPreview, 'url'> | null {
  // 只看 head（没有 head 就看全文，有些页面写得很随意）
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html;

  const meta = new Map<string, string>();
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(head))) {
    const tag = m[0];
    const key = (attrOf(tag, 'property') || attrOf(tag, 'name')).toLowerCase();
    const content = attrOf(tag, 'content');
    if (key && content && !meta.has(key)) meta.set(key, content);
  }

  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = meta.get(k);
      if (v) return v.trim();
    }
    return '';
  };

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
  const title = (pick('og:title', 'twitter:title') || decodeEntities(titleTag.trim())).slice(0, 140);
  const description = pick('og:description', 'twitter:description', 'description').slice(0, 240);
  const site = pick('og:site_name').slice(0, 60);

  // 缩略图：相对路径要按最终地址补全；只留 http(s)
  let image = pick('og:image', 'og:image:url', 'twitter:image');
  if (image) {
    try {
      const abs = new URL(image, base).toString();
      image = safeUrl(abs) ? abs : '';
    } catch {
      image = '';
    }
  }

  if (!title && !description) return null;
  return { title, description, image, site: site || base.hostname.replace(/^www\./, '') };
}

/**
 * 取一条链接的预览（先看缓存）。
 *
 * `ok = 0` 的行也返回 null —— 调用方只需要「有卡片 / 没卡片」这一个答案。
 */
export async function getPreview(env: Env, url: string): Promise<LinkPreview | null> {
  const now = Date.now();

  const hit = await env.DB.prepare(
    'SELECT ok, title, description, image, site, ts FROM chat_link_previews WHERE url = ?',
  )
    .bind(url)
    .first<{ ok: number; title: string | null; description: string | null; image: string | null; site: string | null; ts: number }>()
    .catch(() => null);

  if (hit) {
    const ttl = hit.ok ? TTL_OK : TTL_FAIL;
    if (now - hit.ts < ttl) {
      return hit.ok
        ? {
            url,
            title: hit.title ?? '',
            description: hit.description ?? '',
            image: hit.image ?? '',
            site: hit.site ?? '',
          }
        : null;
    }
  }

  const safe = safeUrl(url);
  if (!safe) return null;

  const got = await fetchHtml(safe);
  const parsed = got ? parsePreview(got.html, got.final) : null;

  await env.DB.prepare(
    `INSERT INTO chat_link_previews (url, ok, title, description, image, site, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       ok = excluded.ok, title = excluded.title, description = excluded.description,
       image = excluded.image, site = excluded.site, ts = excluded.ts`,
  )
    .bind(url, parsed ? 1 : 0, parsed?.title ?? null, parsed?.description ?? null, parsed?.image ?? null, parsed?.site ?? null, now)
    .run()
    .catch(() => undefined);

  return parsed ? { url, ...parsed } : null;
}

/**
 * 后台预热：消息发出去之后在 `waitUntil` 里跑。
 *
 * 失败静默 —— 没有卡片只是少了一点便利，不该让发送报错，也不该写日志刷屏
 * （抓不到是常态：很多站点拒绝外来 UA）。
 */
export async function warmPreview(env: Env, url: string): Promise<void> {
  if (!url) return;
  try {
    await getPreview(env, url);
  } catch {
    /* 静默：卡片是锦上添花 */
  }
}

/** 批量取（一次 IN 查询），给 history / poll 用 */
export async function loadPreviews(env: Env, urls: string[]): Promise<Map<string, LinkPreview>> {
  const map = new Map<string, LinkPreview>();
  const uniq = [...new Set(urls.filter(Boolean))].slice(0, 30);
  if (!uniq.length) return map;

  try {
    const ph = uniq.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT url, ok, title, description, image, site, ts FROM chat_link_previews WHERE url IN (${ph})`,
    )
      .bind(...uniq)
      .all<{ url: string; ok: number; title: string | null; description: string | null; image: string | null; site: string | null; ts: number }>();

    const now = Date.now();
    for (const r of rows.results ?? []) {
      const ttl = r.ok ? TTL_OK : TTL_FAIL;
      if (!r.ok || now - r.ts > ttl) continue;
      map.set(r.url, {
        url: r.url,
        title: r.title ?? '',
        description: r.description ?? '',
        image: r.image ?? '',
        site: r.site ?? '',
      });
    }
  } catch {
    /* 表没建 / 查挂了：当作都没有卡片 */
  }
  return map;
}
