// 清吾 · 后台友链（P2 审核 + P3 回链检查）
//
// ⚠️ 这里有一条贯穿全文的分界线，改代码前先读：
//
//   **友链资料（谁、头像、简介、排序）住在 `src/data/links.json`，那是仓库里的文件，
//   前台构建期静态导入。** 后台改它只有一个合法路径：GitHub Contents API 提交 →
//   服务器 `git pull` + build。任何「写进 D1 然后指望前台看到」的做法都是假的，
//   下一轮构建就会被仓库里的旧内容盖回去 —— 朝朝听雨在文章里踩的就是这个坑。
//
//   而**状态类观察值**（回链还在不在、这个站失联几天了）随时间变化，一天一条地
//   往仓库提交毫无意义，所以放 D1（0014_friends.sql 有解释）。
//
// 提交走乐观锁：前端拿着读到的 sha 一起提交，文件被别人改过就是 409，
// 让前端重新拉一次再改。宁可多一次往返，也不能静默覆盖。

import type { Env } from '../types';
import { json } from '../util';
import type { Admin } from './auth';

const LINKS_PATH = 'src/data/links.json';
const GH_TIMEOUT_MS = 12_000;
const UA = 'qingwu-admin/1.0 (+https://www.qingwu.ink)';

/** 本站域名。回链检查只认它，不带协议头也算（对方写成 qingwu.ink 一样算给了链接）。 */
const SELF_HOST = 'qingwu.ink';

/** 抓取对方站点时的超时与体积上限 —— 有的站首页几十 MB，不能整个读进来。 */
const CRAWL_TIMEOUT_MS = 8_000;
const CRAWL_MAX_BYTES = 400_000;
/** 首页没找到回链时，最多再看几个「友链页」候选。 */
const MAX_CANDIDATE_PAGES = 2;

interface FriendItem {
  name: string;
  avatar: string;
  intro: string;
  url: string;
  visible?: boolean;
  addedAt?: string;
  shot?: string;
}

// ——————————————————————————————————————————————————————————
// 小工具
// ——————————————————————————————————————————————————————————

/** 归一化友链地址：补协议、去尾斜杠、小写主机名。用于和 backlink_checks 对齐。 */
function normUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    u.hash = '';
    u.search = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return s.replace(/\/+$/, '');
  }
}

/** 分段转 base64 —— links.json 现在 10KB 左右，但 `String.fromCharCode(...bytes)` 一次铺开有爆栈风险。 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function ghRepo(env: Env): string {
  return (env.GITHUB_REPO || 'hjphh11/qingwu-blog').trim();
}

function ghHeaders(env: Env): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': UA,
    'x-github-api-version': '2022-11-28',
  };
  if (env.GITHUB_TOKEN) h.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

// ——————————————————————————————————————————————————————————
// 读 links.json
//
// 有 token 走 Contents API（顺带拿到 sha，提交时要用）；
// 没 token 也能读 —— 仓库是公开的，raw.githubusercontent.com 就够，只是拿不到 sha，
// 那种情况下提交会降级成「生成片段让管理员自己贴」，见 commitLinks。
// ——————————————————————————————————————————————————————————
interface LinksSnapshot {
  friends: FriendItem[];
  sha: string | null;
  via: 'api' | 'raw';
}

async function readLinks(env: Env): Promise<LinksSnapshot> {
  const repo = ghRepo(env);

  if (env.GITHUB_TOKEN) {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${LINKS_PATH}?ref=main`, {
      headers: ghHeaders(env),
      signal: AbortSignal.timeout(GH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`GitHub 读失败：HTTP ${res.status}`);
    }
    const data = (await res.json()) as { content?: string; encoding?: string; sha?: string };
    if (!data.content || (data.encoding && data.encoding !== 'base64')) {
      // 文件超过 1MB 时 Contents API 不返回内容（encoding 变 none），那样得走 Git Blob API。
      // links.json 不该到这个体量，真到了说明结构该拆了。
      throw new Error('links.json 体积异常，Contents API 未返回内容');
    }
    const text = new TextDecoder('utf-8').decode(base64ToBytes(data.content));
    return { friends: parseLinks(text), sha: data.sha ?? null, via: 'api' };
  }

  const res = await fetch(`https://raw.githubusercontent.com/${repo}/main/${LINKS_PATH}?t=${Date.now()}`, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(GH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`raw 读失败：HTTP ${res.status}`);
  return { friends: parseLinks(await res.text()), sha: null, via: 'raw' };
}

function parseLinks(text: string): FriendItem[] {
  const data = JSON.parse(text) as { friends?: FriendItem[] };
  const list = Array.isArray(data?.friends) ? data.friends : [];
  return list.map((f) => ({
    name: String(f.name ?? '').trim(),
    avatar: String(f.avatar ?? '').trim(),
    intro: String(f.intro ?? '').trim(),
    url: String(f.url ?? '').trim(),
    visible: f.visible !== false,
    addedAt: f.addedAt ? String(f.addedAt) : undefined,
    shot: f.shot ? String(f.shot) : undefined,
  }));
}

/** 写回仓库。带 sha 就是乐观锁；GitHub 在 sha 过期时返回 409/422。 */
async function writeLinks(
  env: Env,
  friends: FriendItem[],
  sha: string,
  message: string,
): Promise<{ ok: boolean; conflict?: boolean; commit?: string; error?: string }> {
  const repo = ghRepo(env);
  const body = JSON.stringify({ friends }, null, 2) + '\n';
  const content = bytesToBase64(new TextEncoder().encode(body));

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${LINKS_PATH}`, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify({ message, content, sha, branch: 'main' }),
    signal: AbortSignal.timeout(GH_TIMEOUT_MS),
  });

  if (res.status === 409 || res.status === 422) return { ok: false, conflict: true };
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `GitHub 写失败：HTTP ${res.status} ${t.slice(0, 160)}` };
  }
  const data = (await res.json().catch(() => ({}))) as { commit?: { sha?: string } };
  return { ok: true, commit: data?.commit?.sha ?? undefined };
}

// ——————————————————————————————————————————————————————————
// 回链检查
//
// 规则放得很宽（照朝朝听雨的做法）：页面里出现 `qingwu.ink` 就算给了回链，
// 不要求带协议头、不要求是 <a>、不要求精确路径。原因是友链页形态千奇百怪，
// 严格的解析会大量假阴性，而假阴性对站长的代价（误判对方下了链接、可能去怼人）
// 远大于假阳性（漏掉一个坏友链，反正还有人工复审）。
// ——————————————————————————————————————————————————————————
interface CrawlResult {
  ok: boolean;
  status: number;
  text: string;
  error?: string;
}

async function crawl(url: string): Promise<CrawlResult> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS),
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return { ok: false, status: res.status, text: '', error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    // 默认解码器遇到坏字节会替换成 U+FFFD 而不是抛错 —— 对方站点编码写错也不该让整次检查失败
    const text = new TextDecoder('utf-8').decode(buf.slice(0, CRAWL_MAX_BYTES));
    return { ok: true, status: res.status, text };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'fetch_failed';
    return { ok: false, status: 0, text: '', error: name === 'TimeoutError' ? '超时' : name };
  }
}

/** 从首页里挑出可能的「友链页」链接，同源、最多取若干个。 */
function pickLinkPages(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /href=["']([^"'\s>]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!/(link|friend|youlian|youqing|blogroll|links|友链)/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.host !== new URL(base).host) continue;
    abs.hash = '';
    const s = abs.toString();
    if (!out.includes(s)) out.push(s);
    if (out.length >= MAX_CANDIDATE_PAGES) break;
  }
  return out;
}

interface OneCheck {
  url: string;
  name: string;
  ok: boolean;
  status: number;
  matched: string | null;
  error: string | null;
}

async function checkOne(rawUrl: string, name: string): Promise<OneCheck> {
  const base = normUrl(rawUrl);
  const target = base || rawUrl;
  const result: OneCheck = { url: base || rawUrl, name, ok: false, status: 0, matched: null, error: null };

  const first = await crawl(target);
  result.status = first.status;
  if (!first.ok) {
    result.error = first.error ?? '抓取失败';
    return result;
  }
  if (first.text.toLowerCase().includes(SELF_HOST)) {
    result.ok = true;
    result.matched = target;
    return result;
  }

  // 首页没找到 → 再看友链页。常见情况：对方把友链单独挂在 /links。
  for (const page of pickLinkPages(first.text, target)) {
    const sub = await crawl(page);
    if (sub.ok && sub.text.toLowerCase().includes(SELF_HOST)) {
      result.ok = true;
      result.status = sub.status;
      result.matched = page;
      return result;
    }
  }

  result.error = '页面里没找到 qingwu.ink';
  return result;
}

/**
 * 全量回链轮检（cron 与手动「全部重检」共用）。
 * 串行跑：并发打十几个第三方站点容易被当成扫描，而且 workerd 里也没有必要抢时间。
 */
export async function runBacklinkCheck(env: Env, urls?: string[]): Promise<{ total: number; ok: number; failed: number }> {
  let list: FriendItem[];
  if (urls && urls.length > 0) {
    list = urls.map((u) => ({ name: '', url: u, avatar: '', intro: '' }));
  } else {
    try {
      list = (await readLinks(env)).friends.filter((f) => f.visible !== false);
    } catch (err) {
      console.error('[backlink] 读 links.json 失败:', err instanceof Error ? err.message : err);
      return { total: 0, ok: 0, failed: 0 };
    }
  }

  const now = Date.now();
  let ok = 0;
  const stmts: ReturnType<Env['DB']['prepare']>[] = [];

  for (const f of list) {
    const r = await checkOne(f.url, f.name);
    if (r.ok) ok++;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO backlink_checks (url, name, ok, status, matched, error, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           name = excluded.name, ok = excluded.ok, status = excluded.status,
           matched = excluded.matched, error = excluded.error, checked_at = excluded.checked_at`,
      ).bind(r.url, r.name || null, r.ok ? 1 : 0, r.status || null, r.matched, r.error, now),
    );
  }

  if (stmts.length > 0) await env.DB.batch(stmts);
  return { total: list.length, ok, failed: list.length - ok };
}

// ——————————————————————————————————————————————————————————
// GET /admin/friends —— 一屏拿到三块数据
// ——————————————————————————————————————————————————————————
interface AppRow {
  id: number;
  name: string;
  url: string;
  avatar: string | null;
  intro: string | null;
  shot: string | null;
  email: string | null;
  status: string;
  reason: string | null;
  created_at: number;
  handled_at: number | null;
}

export async function getFriendsOverview(request: Request, env: Env, _admin: Admin): Promise<Response> {
  const url = new URL(request.url);
  const skipLinks = url.searchParams.get('skipLinks') === '1';

  // 申请：三块并排，pending 在最前
  const apps = await env.DB.prepare(
    `SELECT id, name, url, avatar, intro, shot, email, status, reason, created_at, handled_at
       FROM applications
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC`,
  ).all<AppRow>();

  const items = (apps.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    avatar: r.avatar ?? '',
    intro: r.intro ?? '',
    shot: r.shot ?? '',
    email: r.email ?? '',
    status: r.status,
    reason: r.reason,
    submittedAt: r.created_at,
    reviewedAt: r.handled_at,
  }));

  const counts = {
    pending: items.filter((a) => a.status === 'pending').length,
    approved: items.filter((a) => a.status === 'approved').length,
    rejected: items.filter((a) => a.status === 'rejected').length,
    total: items.length,
  };

  // 回链与展示状态
  const checks = await env.DB.prepare('SELECT url, name, ok, status, matched, error, checked_at FROM backlink_checks')
    .all<{ url: string; name: string | null; ok: number; status: number | null; matched: string | null; error: string | null; checked_at: number }>();
  const statuses = await env.DB.prepare('SELECT url, state, note, until, updated_at FROM friend_status')
    .all<{ url: string; state: string; note: string | null; until: number | null; updated_at: number }>();

  const checkMap: Record<string, unknown> = {};
  for (const c of checks.results ?? []) checkMap[c.url] = { ...c, ok: c.ok === 1 };
  const statusMap: Record<string, unknown> = {};
  for (const s of statuses.results ?? []) statusMap[s.url] = s;

  // links.json：后台唯一的真相源。读失败不该让整页崩掉（GitHub 偶尔抽风），
  // 前端拿到 linksError 会显示重试提示，申请列表照常能审。
  let links: FriendItem[] = [];
  let sha: string | null = null;
  let linksError: string | null = null;
  if (!skipLinks) {
    try {
      const snap = await readLinks(env);
      links = snap.friends;
      sha = snap.sha;
    } catch (err) {
      linksError = err instanceof Error ? err.message : String(err);
    }
  }

  return json({
    ok: true,
    applications: items,
    counts,
    links,
    sha,
    linksError,
    writable: Boolean(env.GITHUB_TOKEN && sha),
    checks: checkMap,
    statuses: statusMap,
    fetchedAt: Date.now(),
  });
}

// ——————————————————————————————————————————————————————————
// POST /admin/friends/apply/:id —— 通过 / 拒绝
//
// ⚠️ 「通过」只改 applications.status，**不会自动把对方写进 links.json**。
// 这两件事必须分开：审批是「我同意收录」，收录是「我确认他的资料长这样」，
// 而且后者要改仓库、要构建。合并成一个按钮的话，误点一次就得回滚一次 commit。
// ——————————————————————————————————————————————————————————
export async function patchApplication(request: Request, env: Env, admin: Admin, id: number): Promise<Response> {
  let body: { status?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as { status?: unknown; reason?: unknown };
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }

  const status = String(body.status ?? '').trim();
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return json({ ok: false, reason: 'bad_status' }, 400);
  }
  const reason = status === 'rejected' ? String(body.reason ?? '').trim().slice(0, 200) || null : null;
  const handledAt = status === 'pending' ? null : Date.now();

  const res = await env.DB.prepare('UPDATE applications SET status = ?, reason = ?, handled_at = ? WHERE id = ?')
    .bind(status, reason, handledAt, id)
    .run();
  if (!res.meta?.changes) return json({ ok: false, reason: 'not_found' }, 404);

  console.log(`[admin] ${admin.username} 把申请 ${id} 改为 ${status}`);
  return json({ ok: true, status });
}

// ——————————————————————————————————————————————————————————
// POST /admin/friends/links —— 提交整份 links.json
//
// 前端把「完整数组 + 读到的 sha」一起发上来。为什么整份而不是 diff：
// links.json 只有十几条，整份提交最简单、无歧义；diff 还得处理数组重排的歧义。
// ——————————————————————————————————————————————————————————
export async function commitLinks(request: Request, env: Env, admin: Admin): Promise<Response> {
  let body: { friends?: unknown; sha?: unknown; message?: unknown; baseSha?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }

  if (!Array.isArray(body.friends) || body.friends.length === 0) {
    return json({ ok: false, reason: 'empty' }, 400);
  }

  const friends: FriendItem[] = body.friends.map((raw) => {
    const f = raw as Record<string, unknown>;
    return {
      name: String(f.name ?? '').trim(),
      avatar: String(f.avatar ?? '').trim(),
      intro: String(f.intro ?? '').trim(),
      url: String(f.url ?? '').trim(),
      visible: f.visible !== false,
      addedAt: f.addedAt ? String(f.addedAt) : undefined,
      shot: f.shot ? String(f.shot) : undefined,
    };
  });

  const bad = friends.findIndex((f) => !f.name || !f.url);
  if (bad >= 0) return json({ ok: false, reason: 'incomplete', index: bad }, 400);

  const sha = String(body.sha ?? '').trim();

  // 没有 token 或没有 sha → 没法安全提交。把成品 JSON 回给前端让它显示「复制粘贴」。
  if (!env.GITHUB_TOKEN || !sha) {
    return json(
      {
        ok: false,
        reason: 'manual',
        message: env.GITHUB_TOKEN
          ? '这次读文件时没拿到 sha（可能走了 raw 路径），刷新一次再提交'
          : '未配置 GITHUB_TOKEN，请复制下面的内容手动更新 src/data/links.json',
        friends,
        text: JSON.stringify({ friends }, null, 2) + '\n',
      },
      200,
    );
  }

  const message =
    String(body.message ?? '').trim().slice(0, 120) || `chore(links): 后台更新友链（${admin.username}）`;

  try {
    const r = await writeLinks(env, friends, sha, message);
    if (r.conflict) {
      return json(
        {
          ok: false,
          reason: 'conflict',
          message: 'links.json 在你看这份的期间被改过（可能是你另一台设备，或别的提交）。请刷新后重新改一次。',
        },
        409,
      );
    }
    if (!r.ok) return json({ ok: false, reason: 'github_error', message: r.error }, 502);

    console.log(`[admin] ${admin.username} 提交 links.json：${friends.length} 条，commit ${r.commit}`);
    return json({
      ok: true,
      commit: r.commit,
      message: '已提交到仓库。前台要等服务器 `git pull` + build 之后才会变（约 40 秒）。',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, reason: 'network', message: msg }, 502);
  }
}

// ——————————————————————————————————————————————————————————
// POST /admin/friends/backlinks —— 手动重检
// ——————————————————————————————————————————————————————————
export async function checkBacklinks(request: Request, env: Env, _admin: Admin): Promise<Response> {
  let body: { urls?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* 空 body 合法：表示「全部重检」 */
  }
  const urls = Array.isArray(body.urls) ? body.urls.map((u) => String(u)).filter(Boolean).slice(0, 20) : undefined;

  const started = Date.now();
  const res = await runBacklinkCheck(env, urls);
  return json({ ok: true, total: res.total, passed: res.ok, failed: res.failed, tookMs: Date.now() - started });
}

// ——————————————————————————————————————————————————————————
// POST /admin/friends/status —— 失联 / 违规倒计时
// ——————————————————————————————————————————————————————————
const STATUS_DAYS: Record<string, number> = { normal: 0, unstable: 30, violation: 7 };

export async function setFriendStatus(request: Request, env: Env, _admin: Admin): Promise<Response> {
  let body: { url?: unknown; state?: unknown; note?: unknown; days?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }

  const url = normUrl(String(body.url ?? ''));
  const state = String(body.state ?? '').trim();
  if (!url) return json({ ok: false, reason: 'no_url' }, 400);
  if (!(state in STATUS_DAYS)) return json({ ok: false, reason: 'bad_state' }, 400);

  if (state === 'normal') {
    await env.DB.prepare(
      `INSERT INTO friend_status (url, state, note, until, updated_at) VALUES (?, 'normal', NULL, NULL, ?)
       ON CONFLICT(url) DO UPDATE SET state = 'normal', note = NULL, until = NULL, updated_at = excluded.updated_at`,
    )
      .bind(url, Date.now())
      .run();
    return json({ ok: true, state, until: null });
  }

  const explicit = Number(body.days);
  const days = Number.isFinite(explicit) && explicit > 0 ? Math.min(explicit, 90) : STATUS_DAYS[state];
  const until = Date.now() + days * 86_400_000;
  const note = String(body.note ?? '').trim().slice(0, 60) || null;

  await env.DB.prepare(
    `INSERT INTO friend_status (url, state, note, until, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET state = excluded.state, note = excluded.note,
                                    until = excluded.until, updated_at = excluded.updated_at`,
  )
    .bind(url, state, note, until, Date.now())
    .run();

  return json({ ok: true, state, until, days });
}
