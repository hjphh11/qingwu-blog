// 清吾 · 友链申请的「实地核查」（给爱弥斯看的现场记录）
//
// 来历（2026-11-18）：访客在留言板按「站点名称/站点地址/头像/简介」的格式留言，
// 小爱原本只看到那几行字，于是回「申请收到了，链接我加上」——**她根本没去看过对方站点**。
// 站长要的是：第一次回复之前，先自己去把这两件事查清楚，再照实说。
//
//   ① 回链有没有：对方站上能不能找到 qingwu.ink（规则与 admin/friends.ts 一致，放得很宽）
//   ② 对方是什么站：标题、描述、是不是前端渲染、导航里有没有友链页
//
// 这里只做「取证」，不做判断 —— 判断交给模型，而且**明确告诉它哪些看不到**
// （SPA 站点抓不到正文时必须说「我看不到」，不能顺势断言「你没加链接」）。
//
// ⚠️ 抓取一律带超时：这段跑在 `ctx.waitUntil` 里，拖死的是 Worker 实例本身。

import type { Env } from '../types';

const UA = 'qingwu-bot/1.0 (+https://www.qingwu.ink)';
/** 单页 6s —— 与 admin/friends.ts 同口径，别在这里调大（最坏 4 页 × 6s） */
const PAGE_TIMEOUT_MS = 6_000;
/** 单页最多读这么多；超过就截断，够判断标题和有没有回链了 */
const MAX_BYTES = 1_200_000;
/** 首页之外最多再看几个候选友链页 */
const MAX_EXTRA_PAGES = 3;
const GUESS_PATHS = ['/links/', '/friends/', '/link/'];
const SELF_HOST = 'qingwu.ink';

export interface ReconInfo {
  url: string;
  reachable: boolean;
  status: number;
  error: string | null;
  title: string;
  desc: string;
  keywords: string[];
  /** 前端渲染（HTML 里几乎没有正文）—— 抓不到内容 ≠ 对方没写 */
  spa: boolean;
  /** 首页可读正文片段（去标签） */
  excerpt: string;
  /** 首页出现过的站内路径，用来判断「有没有友链页」 */
  paths: string[];
  backlink: {
    found: boolean;
    /** 在哪一页找到的 */
    matchedAt: string | null;
    /** 实际点开过的页面 */
    checked: string[];
  };
}

// ——————————————————————————————————————————————————————————
// 从留言正文里认申请
// ——————————————————————————————————————————————————————————
export interface ParsedApply {
  name: string;
  url: string;
  avatar: string;
  intro: string;
}

const URL_RE = /https?:\/\/[^\s<>"'）)】]+/i;

/**
 * 只在「像申请」的时候返回，否则 null。
 *
 * 判据刻意保守：正文里必须**同时**出现「站点名称/站点地址（或网址/链接）」这类
 * 明确字段，并且能解析出一个 http(s) 地址。纯聊天的留言哪怕贴了个链接也不动，
 * 免得把每条带链接的留言都当成友链申请去抓一遍。
 */
export function parseApplyBody(body: string): ParsedApply | null {
  const text = (body || '').trim();
  if (!text || text.length > 1200) return null;

  const hasNameField = /站点\s*(?:名称|名字|标题)\s*[:：]/.test(text);
  const hasUrlField = /站点\s*(?:地址|网址|链接|URL)\s*[:：]|(?:地址|网址|链接)\s*[:：]/i.test(text);
  if (!hasNameField || !hasUrlField) return null;

  const urlM = text.match(URL_RE);
  if (!urlM) return null;

  const pick = (re: RegExp): string => {
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  const url = urlM[0].replace(/[.,;，。；、]+$/, '');
  const name = pick(/站点\s*(?:名称|名字|标题)\s*[:：]\s*([^\n\r]{1,40})/);
  const avatar = pick(/站点\s*(?:头像|图标|logo)\s*[:：]\s*(https?:\/\/[^\s]+)/i);
  const intro = pick(/站点\s*(?:简介|介绍|描述)\s*[:：]\s*([^\n\r]{1,120})/);

  if (!name) return null;
  return { name, url, avatar, intro };
}

/**
 * 正则认不出来、但 judge 说「这是友链申请」时的兜底抽取。
 *
 * 有人不按格式写（「我想和你换个友链，我站叫小石屋 blog.xxx.com」），
 * 结构化字段一个都没有，可 judge 判得出来 —— 那就把能拿到的先拿到：
 * 留言时填的「站点」优先，其次是正文里第一个 http(s) 地址；名字用留言昵称。
 *
 * 拿不到任何地址就返回 null —— `applications.url` 是 NOT NULL + UNIQUE，
 * 硬塞一个空串只会污染去重。
 */
export function fallbackApply(body: string, author: string, site = ''): ParsedApply | null {
  const text = (body || '').trim();
  const fromBody = (text.match(URL_RE)?.[0] ?? '').replace(/[.,;，。；、]+$/, '');
  const url = (site || '').trim() || fromBody;
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) return null;

  const name = (author || '').trim().slice(0, 30) || '未署名站点';
  // 简介：把地址从正文里抹掉，剩下的前半段 —— 比留空有用。
  // 顺带清掉「地址是 ，」这种抹完 URL 留下的空档，否则后台列表里一行脏字
  const intro = text
    .replace(url, ' ')
    .replace(/(?:网址|地址|链接)\s*(?:是|为|[:：])?\s*[，,、。；;\s]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const avatar = text.match(/https?:\/\/[^\s"'）)】]+\.(?:png|jpe?g|webp|gif|svg|ico)/i)?.[0] ?? '';
  return { name, url, avatar, intro };
}

/**
 * 往「友链审核」补一条待审记录。
 *
 * **幂等**：`applications.url` 上有 UNIQUE，用 `INSERT OR IGNORE` 吞掉重复，
 * 同一个人重复留言不会堆出一串同样的待审。
 * 写不进去只 warn —— 访客的留言已经落库了，这一步失败不该有任何副作用。
 */
export async function saveApply(env: Env, a: ParsedApply, email?: string | null): Promise<boolean> {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO applications (name, url, avatar, intro, shot, email, status, created_at, ip_key)
       VALUES (?, ?, ?, ?, '', ?, 'pending', ?, NULL)`,
    )
      .bind(a.name, a.url, a.avatar, a.intro, (email ?? '').trim() || null, Date.now())
      .run();
    return true;
  } catch (e) {
    console.warn('[recon] 补录友链申请失败：', e instanceof Error ? e.message : e);
    return false;
  }
}

// ——————————————————————————————————————————————————————————
// 抓取
// ——————————————————————————————————————————————————————————
interface Page {
  ok: boolean;
  status: number;
  html: string;
  finalUrl: string;
  error: string | null;
}

async function grab(url: string): Promise<Page> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return { ok: false, status: res.status, html: '', finalUrl: url, error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf).slice(0, MAX_BYTES);
    const html = new TextDecoder('utf-8').decode(bytes);
    return { ok: true, status: res.status, html, finalUrl: res.url || url, error: null };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'fetch_failed';
    return {
      ok: false,
      status: 0,
      html: '',
      finalUrl: url,
      error: name === 'TimeoutError' || name === 'AbortError' ? '超时' : name,
    };
  }
}

function meta(html: string, keys: string[]): string {
  for (const k of keys) {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${k}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    if (!tag) continue;
    const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content).trim();
  }
  return '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}

/**
 * 前端渲染站点的特征。
 *
 * 云年那个站就是典型：所有路径都回同一份 index.html，回链写在 JS 里渲染出来，
 * 服务端抓 HTML 永远看不到。这种情况下「没找到」**不能**当成「对方没加」。
 */
function looksClientRendered(html: string, textLen: number): boolean {
  if (textLen > 400) return false;
  return (
    /<div[^>]+id=["'](?:app|root)["']/i.test(html) ||
    /\/assets\/index[.-][A-Za-z0-9_-]+\.(?:js|css)/i.test(html) ||
    /<script[^>]+type=["']module["']/i.test(html)
  );
}

/** 首页里同主机的链接路径（去重，只留 pathname） */
function sameHostPaths(html: string, base: string): string[] {
  let host = '';
  try {
    host = new URL(base).host;
  } catch {
    return [];
  }
  const out: string[] = [];
  const re = /href=["']([^"'\s>#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (/^(?:mailto|tel|javascript):/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.host !== host) continue;
    const p = abs.pathname;
    if (!p || p === '/' || out.includes(p)) continue;
    out.push(p);
    if (out.length >= 40) break;
  }
  return out;
}

// ——————————————————————————————————————————————————————————
// 主入口
// ——————————————————————————————————————————————————————————
/**
 * 去对方站点实地看一圈。**不抛错**，网络再烂也返回一个 reachable:false 的结构。
 */
export async function reconSite(rawUrl: string): Promise<ReconInfo> {
  const url = rawUrl.trim();
  const info: ReconInfo = {
    url,
    reachable: false,
    status: 0,
    error: null,
    title: '',
    desc: '',
    keywords: [],
    spa: false,
    excerpt: '',
    paths: [],
    backlink: { found: false, matchedAt: null, checked: [] },
  };

  if (!/^https?:\/\//i.test(url)) {
    info.error = '地址不是 http(s) 链接';
    return info;
  }

  let home = await grab(url);
  // https 掉证书的独立博客不少，退一次 http 再说
  if (!home.ok && url.startsWith('https://')) {
    const alt = url.replace(/^https:/, 'http:');
    const retry = await grab(alt);
    if (retry.ok) {
      home = retry;
      info.url = alt;
    }
  }

  info.status = home.status;
  info.backlink.checked.push(info.url);

  if (!home.ok) {
    info.error = home.error ?? '抓取失败';
    return info;
  }

  info.reachable = true;
  const html = home.html;
  const text = htmlToText(html);

  info.title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  info.desc = meta(html, ['description', 'og:description']).slice(0, 240);
  info.keywords = meta(html, ['keywords'])
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  info.spa = looksClientRendered(html, text.length);
  info.excerpt = text.slice(0, 700);
  info.paths = sameHostPaths(html, info.url);

  // ① 首页就有 → 直接算给了回链
  if (html.toLowerCase().includes(SELF_HOST)) {
    info.backlink.found = true;
    info.backlink.matchedAt = info.url;
    return info;
  }

  // ② 首页没有 → 找友链页再看。先找导航里像友链的入口，不够再猜常见路径
  const candidates: string[] = [];
  for (const p of info.paths) {
    if (!/(link|friend|youlian|youqing|blogroll|friendlink)/i.test(p)) continue;
    if (candidates.includes(p)) continue;
    candidates.push(p);
    if (candidates.length >= MAX_EXTRA_PAGES) break;
  }
  for (const p of GUESS_PATHS) {
    if (candidates.length >= MAX_EXTRA_PAGES) break;
    if (!candidates.includes(p)) candidates.push(p);
  }

  let origin = '';
  try {
    origin = new URL(info.url).origin;
  } catch {
    /* 上面已经校验过，这里不会失败 */
  }

  for (const p of candidates.slice(0, MAX_EXTRA_PAGES)) {
    const abs = p.startsWith('http') ? p : origin + p;
    if (info.backlink.checked.includes(abs)) continue;
    const page = await grab(abs);
    info.backlink.checked.push(abs);
    if (!page.ok) continue;
    if (page.html.toLowerCase().includes(SELF_HOST)) {
      info.backlink.found = true;
      info.backlink.matchedAt = abs;
      return info;
    }
  }

  return info;
}

// ——————————————————————————————————————————————————————————
// 给模型看的现场记录
// ——————————————————————————————————————————————————————————
/**
 * 拼成一段**事实清单**塞进 user 消息。
 *
 * 措辞上的两处刻意：
 * · 可达性单独说 —— 抓不到时不能说「你没加链接」，那是冤枉人
 * · SPA 单独说 —— 前端渲染的站，源码里永远搜不到东西
 */
export function reconBlock(r: ReconInfo): string {
  const lines: string[] = ['【友链申请 · 系统实地核查（下面是真实抓取结果，不是访客自述）】'];

  if (!r.reachable) {
    lines.push(`- 对方站点：${r.url}`);
    lines.push(`- 抓取结果：**打不开**（${r.error ?? '未知原因'}）`);
    lines.push('- 所以回链、站点内容都无从确认。别猜，直接说「我这边打不开你的站」。');
    return lines.join('\n');
  }

  lines.push(`- 对方站点：${r.url}（HTTP ${r.status} 可访问）`);
  if (r.title) lines.push(`- 页面标题：${r.title}`);
  if (r.desc) lines.push(`- 站点自述：${r.desc}`);
  if (r.keywords.length) lines.push(`- 关键词：${r.keywords.join('、')}`);
  if (r.spa) {
    lines.push(
      '- ⚠️ 这个站是**前端渲染**（HTML 里基本没有正文，内容靠 JS 画出来）：' +
        '源码里搜不到东西是正常的，**不能据此断定人家没加回链**。',
    );
  } else if (r.excerpt) {
    lines.push(`- 首页正文摘录：${r.excerpt}`);
  }

  const linkish = r.paths.filter((p) => /(link|friend|youlian|youqing)/i.test(p)).slice(0, 3);
  lines.push(
    linkish.length
      ? `- 站内有友链页入口：${linkish.join('、')}`
      : '- 首页没看到明显的「友链」页入口',
  );

  if (r.backlink.found) {
    lines.push(`- 回链检测：**已经给了** —— 在 ${r.backlink.matchedAt} 这一页里找到了 qingwu.ink`);
  } else {
    lines.push(`- 回链检测：**没找到** qingwu.ink。查过这些页：${r.backlink.checked.join('、')}`);
    if (r.spa) lines.push('- 但对方是前端渲染站，这个「没找到」仅供参考，别当成罪证。');
  }

  return lines.join('\n');
}
