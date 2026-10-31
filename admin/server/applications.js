// 友链申请审批（阶段 J · 第 2 步迁移：数据源从私有仓库改成 Cloudflare D1）
//
// **数据在哪**：Cloudflare D1（Worker 的 `applications` 表）。
// 为什么不再放私有仓库：申请里带**访客邮箱**，`qingwu-blog` 是 public，
// 而私有仓库那套「读 sha → 改 → 带 sha 写回」本质是拿 git 当数据库用 ——
// 没法索引、没法 UNIQUE 去重、并发还要重试。D1 有 `UNIQUE(url)` 和索引，天然合适。
//
// 读写都走 Worker 的 HTTP 接口（和统计的 `/stats` 同一套鉴权思路）：
//   · GET   `/apply`       带 `Authorization: Bearer <ADMIN_APPLY_TOKEN>` → 全部申请
//   · PATCH `/apply/:id`   同样的口令 → 改 status / reason
//   · 返回形状与旧的 `applications.json` **逐字段一致**，所以 `Applications.jsx` 一行都不用改。
//
// **通过**仍然是：先追加进 `src/data/links.json`（自动补 `addedAt`/`visible`、自带去重）
// → 于是它出现在「待发布」里，去发布页点一下就上线（阶段 I）；
// 成功之后再回写 D1 的 status。顺序很重要，见 `approveApplication` 的注释。
import { z } from 'zod';
import { config } from './config.js';
import { conflict, httpError } from './jsonFile.js';
import { listLinks, saveLinks } from './links.js';
import { appendLog } from './oplog.js';

/** Worker 返回的单条申请。字段与旧 `applications.json` 一致。 */
const ApplicationSchema = z.object({
  id: z.string().trim().min(1, '缺少 id'),
  name: z.string().trim().min(1, '名字不能为空').max(60, '名字太长'),
  url: z.string().trim().min(1, '链接不能为空').max(300, '链接太长'),
  avatar: z.string().trim().max(300, '头像链接太长').default(''),
  intro: z.string().trim().max(200, '介绍太长').default(''),
  email: z.string().trim().max(160, '邮箱太长').default(''),
  submittedAt: z.string().default(''),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  reviewedAt: z.string().nullish(),
  reason: z.string().max(200, '拒绝原因太长').nullish(),
});

const ListSchema = z.object({
  enabled: z.boolean().default(true),
  repo: z.string().optional(),
  path: z.string().optional(),
  items: z.array(ApplicationSchema).default([]),
  counts: z
    .object({
      pending: z.number().default(0),
      approved: z.number().default(0),
      rejected: z.number().default(0),
      total: z.number().default(0),
    })
    .optional(),
  fetchedAt: z.string().optional(),
});

/** 没配接口/口令时给前端的说明（不是报错，是「还没配」）*/
function notConfigured(reason) {
  return {
    enabled: false,
    repo: 'cloudflare-d1',
    path: 'applications',
    reason,
    items: [],
    counts: { pending: 0, approved: 0, rejected: 0, total: 0 },
  };
}

/** 站点地址规范化，用于「是不是同一个站」的比较（与 Worker 侧 urlKey 同义） */
function urlKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

const applyUrl = (suffix = '') => `${config.applyApiBase.replace(/\/$/, '')}/apply${suffix}`;

/**
 * **迁移守卫**：`ADMIN_APPLY_TOKEN` 这个变量名以前存的是 GitHub PAT（`github_pat_…` / `ghp_…`），
 * 现在要存的是 Worker 的 `ADMIN_APPLY_TOKEN` 口令。同名不同义，配错了只会得到 401，
 * 而 401 的提示很容易被当成「口令写错了」而想不到「这是上一个时代的 token」。
 * 所以这里显式识别一次，给出能照着改的提示。
 */
function assertNotGithubToken() {
  const t = String(config.applyApiToken || '');
  if (/^(github_pat_|ghp_|gho_|ghu_|ghs_)/.test(t)) {
    return (
      'ADMIN_APPLY_TOKEN 里放的还是 GitHub PAT —— 第 2 步迁移后它应该是 ' +
      'Worker 上 `wrangler secret put ADMIN_APPLY_TOKEN` 设的那个口令。' +
      '申请数据已经不在私有仓库了，这个 token 不再需要 GitHub 权限'
    );
  }
  return null;
}

const apiHeaders = () => ({
  accept: 'application/json',
  authorization: `Bearer ${config.applyApiToken}`,
});

/** 统一把「连不上 / 401 / 5xx」翻译成人能看懂的错误 */
async function callWorker(path, init = {}) {
  let res;
  try {
    res = await fetch(applyUrl(path), {
      ...init,
      headers: { ...apiHeaders(), ...(init.body ? { 'content-type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(config.applyTimeoutMs),
    });
  } catch (err) {
    throw httpError(
      502,
      `连不上友链接口（${applyUrl(path)}）：${err.message}`,
      'apply_unreachable',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw httpError(
      502,
      `友链接口拒绝访问（HTTP ${res.status}）—— 检查 ADMIN_APPLY_TOKEN 是否与 Worker 的 ADMIN_APPLY_TOKEN 一致`,
      'apply_auth',
    );
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw httpError(502, `友链接口返回 HTTP ${res.status} ${bodyText.slice(0, 120)}`, 'apply_api_failed');
  }

  let parsed;
  try {
    parsed = await res.json();
  } catch {
    throw httpError(502, '友链接口返回的不是 JSON', 'apply_bad_json');
  }
  return parsed;
}

// ——— 列表缓存（单用户后台；翻来翻去不必每次都打跨境请求）———
let cache = { at: 0, data: null };

/** 审批列表：待审批在前，同状态按提交时间倒序（排序也在 Worker 里做了，这里只兜底） */
export async function listApplications({ force = false } = {}) {
  if (!config.applyApiToken) {
    return notConfigured('没配 ADMIN_APPLY_TOKEN —— 读不到 Cloudflare D1 里的申请列表');
  }
  const stale = assertNotGithubToken();
  if (stale) return notConfigured(stale);

  if (!force && cache.data && Date.now() - cache.at < config.applyCacheMs) return cache.data;

  const raw = await callWorker('');
  const check = ListSchema.safeParse(raw);
  if (!check.success) {
    const first = check.error.issues[0];
    throw httpError(
      502,
      `申请数据格式不对：items.${first.path.join('.') || '?'} —— ${first.message}`,
      'apply_bad_shape',
    );
  }

  const order = { pending: 0, approved: 1, rejected: 2 };
  const items = [...check.data.items].sort(
    (a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
      String(b.submittedAt).localeCompare(String(a.submittedAt)),
  );

  const data = {
    enabled: true,
    repo: raw.repo || 'cloudflare-d1',
    path: raw.path || 'applications',
    items,
    counts: {
      pending: items.filter((a) => a.status === 'pending').length,
      approved: items.filter((a) => a.status === 'approved').length,
      rejected: items.filter((a) => a.status === 'rejected').length,
      total: items.length,
    },
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
  };
  cache = { at: Date.now(), data };
  return data;
}

/** 侧栏角标用：只要待审批数量（走缓存，不额外打接口） */
export async function applicationsSummary() {
  if (!config.applyApiToken) return { enabled: false, pending: 0 };
  try {
    const d = await listApplications();
    return { enabled: true, pending: d.counts.pending, total: d.counts.total };
  } catch (err) {
    return { enabled: true, pending: 0, error: err.message };
  }
}

async function findOne(id, apps) {
  const app = apps.find((a) => a.id === id);
  if (!app) throw httpError(404, '找不到这条申请（列表可能已经刷新，点一下刷新再看）', 'apply_not_found');
  return app;
}

/** 改状态：PATCH /apply/:id */
async function setStatus(id, status, reason = null) {
  const body = await callWorker(`/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason }),
  });
  cache = { at: 0, data: null };
  return body?.application ?? null;
}

/**
 * 通过：① 写进 links.json（进入待发布）→ ② 把 status 写回 D1。
 * 顺序很重要：先写 links.json。万一第 ② 步失败，申请还是 pending，
 * 你可以再点一次（links 那边有同名链接去重，不会重复添加）。
 */
export async function approveApplication(id, { force = false } = {}) {
  if (!config.applyApiToken) throw conflict('没配 ADMIN_APPLY_TOKEN，读不到申请列表');
  const data = await listApplications({ force });
  const app = await findOne(String(id ?? ''), data.items);
  if (app.status === 'approved') throw conflict('这条申请已经通过过了');

  const { friends } = await listLinks();
  const key = urlKey(app.url);
  if (friends.some((f) => urlKey(f.url) === key)) {
    throw conflict(`「${app.name}」的链接已经在友链列表里了 —— 直接把这条申请标成「已拒绝」或忽略即可`);
  }

  // links.json 的校验要求头像/名字/链接都非空（前台 /links 没有兜底图，空头像会显示裂图）。
  // 正常申请表单这三项都是必填，但万一数据是手工塞进来的，这里要给出能照着做的提示，
  // 而不是甩一句 `friends.2.avatar：不能为空`。
  if (!app.avatar.trim()) {
    throw conflict(
      `「${app.name}」这条申请没填头像链接 —— 去「友链」页手动加一条（填好头像）更省事；` +
        `或者让对方重新提交一次申请`,
    );
  }

  try {
    await saveLinks({
      friends: [
        ...friends,
        { name: app.name, url: app.url, avatar: app.avatar, intro: app.intro, visible: true },
      ],
    });
  } catch (err) {
    throw conflict(`这条申请的数据没通过友链校验（${err.message}）—— 建议去「友链」页手动加一条`);
  }

  let updated = null;
  try {
    updated = await setStatus(app.id, 'approved');
  } catch (err) {
    // links.json 已经写进去了，这里失败不能把功劳吞掉 —— 明确告诉用户「还差一步」
    throw conflict(
      `已经写进友链列表（待发布），但回写审批状态失败：${err.message}。` +
        `去 D1 里把这条的 status 改成 approved，或者再点一次「通过」`,
    );
  }

  await appendLog({
    action: 'approve',
    repo: 'cloudflare-d1',
    application: { id: app.id, name: app.name, url: app.url },
    result: '已写进 links.json（待发布）',
  });

  return { ok: true, application: updated ?? { ...app, status: 'approved' }, links: await listLinks() };
}

/** 拒绝：改 status（可留原因）。对方之后可以重新申请（去重逻辑认这个状态） */
export async function rejectApplication(id, reason = '') {
  if (!config.applyApiToken) throw conflict('没配 ADMIN_APPLY_TOKEN，读不到申请列表');
  const data = await listApplications({ force: true });
  const app = await findOne(String(id ?? ''), data.items);
  if (app.status === 'rejected') throw conflict('这条申请已经拒绝过了');

  const note = String(reason ?? '').trim().slice(0, 200);
  const updated = await setStatus(app.id, 'rejected', note || null);

  await appendLog({
    action: 'reject',
    repo: 'cloudflare-d1',
    application: { id: app.id, name: app.name, url: app.url },
    reason: note,
    result: '已标记为拒绝',
  });

  return { ok: true, application: updated ?? { ...app, status: 'rejected', reason: note || null } };
}

/** 把某条申请改回「待审批」（点错了能撤回）*/
export async function reopenApplication(id) {
  if (!config.applyApiToken) throw conflict('没配 ADMIN_APPLY_TOKEN，读不到申请列表');
  const data = await listApplications({ force: true });
  const app = await findOne(String(id ?? ''), data.items);

  const updated = await setStatus(app.id, 'pending');
  await appendLog({
    action: 'reopen',
    repo: 'cloudflare-d1',
    application: { id: app.id, name: app.name },
    result: '已改回待审批',
  });
  return { ok: true, application: updated ?? { ...app, status: 'pending', reviewedAt: null, reason: null } };
}

/** 仅供测试/自检：清掉列表缓存 */
export function clearApplicationsCache() {
  cache = { at: 0, data: null };
}
