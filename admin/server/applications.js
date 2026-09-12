// 友链申请审批（阶段 J · 方案 §4.5 + 第 35 / 36 / 49 条）
//
// 申请数据存在**私有仓库**（`hjphh11/qingwu-link-applications`）里，不进公开的博客仓库 ——
// 因为申请里带**访客邮箱**，而 `qingwu-blog` 是 public，写进去会永久留在公开 git 历史里。
//
// 读写都走 GitHub Contents API（和阶段 B 的 Vercel 函数同一套）：
//   · 读：审批列表
//   · 写：**通过 / 拒绝 = 把 `status` 写回私有仓库**。
//     为什么不只在本地记？因为：
//       1. 阶段 B 的去重逻辑就认 `status`（`rejected` 之后对方可以重新申请），
//          状态写在仓库里两端才一致；
//       2. 状态跟着私有仓库走，服务器重装也不会丢。
//
// **通过** = 追加进 `src/data/links.json`（走 links 模块，自动补 `addedAt`/`visible`、
// 并自带同名链接去重）→ 于是它出现在「待发布」里，去发布页点一下就上线（阶段 I）。
import { z } from 'zod';
import { config } from './config.js';
import { conflict, httpError } from './jsonFile.js';
import { listLinks, saveLinks } from './links.js';
import { appendLog } from './oplog.js';

const ApplicationSchema = z.object({
  id: z.string().trim().min(1, '缺少 id'),
  name: z.string().trim().min(1, '名字不能为空').max(60, '名字太长'),
  url: z.string().trim().min(1, '链接不能为空').max(300, '链接太长'),
  avatar: z.string().trim().max(300, '头像链接太长').default(''),
  intro: z.string().trim().max(200, '介绍太长').default(''),
  email: z.string().trim().max(160, '邮箱太长').default(''),
  submittedAt: z.string().default(''),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  // ↓ 这两个字段是**后台审批时**写回去的（Vercel 函数只写 status: 'pending'）
  reviewedAt: z.string().nullish(),
  reason: z.string().max(200, '拒绝原因太长').nullish(),
});

const FileSchema = z.object({
  applications: z.array(ApplicationSchema).default([]),
});

/** 仓库里读到的原始记录（Vercel 函数写的时候可能少字段，这里都补上默认值） */
function normalize(app) {
  return {
    ...app,
    avatar: app.avatar ?? '',
    intro: app.intro ?? '',
    email: app.email ?? '',
    status: app.status ?? 'pending',
    reviewedAt: app.reviewedAt ?? null,
    reason: app.reason ?? null,
  };
}

/** 没配 token 时给前端的说明（不是报错，是「还没配」）*/
function notConfigured() {
  return {
    enabled: false,
    repo: config.applyRepo,
    path: config.applyPath,
    reason: '没配 ADMIN_APPLY_TOKEN —— 审批列表读不到私有仓库里的申请',
    items: [],
    counts: { pending: 0, approved: 0, rejected: 0, total: 0 },
  };
}

const contentsUrl = () =>
  `${config.applyApiBase.replace(/\/$/, '')}/repos/${config.applyRepo}/contents/${config.applyPath}`;

const ghHeaders = () => ({
  authorization: `Bearer ${config.applyToken}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'qingwu-admin',
  'x-github-api-version': '2022-11-28',
});

/** 读私有仓库里的申请文件 → { apps, sha }（文件还不存在时给空列表，让首次写入能建文件） */
async function fetchApplications() {
  const res = await fetch(`${contentsUrl()}?ref=${encodeURIComponent(config.applyRef)}`, {
    headers: ghHeaders(),
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 404) return { apps: [], sha: null };
  if (res.status === 401 || res.status === 403) {
    throw httpError(502, `私有仓库 ${config.applyRepo} 的 token 无效或权限不够（GitHub ${res.status}）`, 'apply_auth');
  }
  if (!res.ok) {
    throw httpError(502, `读取申请列表失败：GitHub ${res.status}`, 'apply_read');
  }

  const data = await res.json();
  const raw = Buffer.from(String(data.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw httpError(502, `${config.applyPath} 不是合法 JSON，先去私有仓库修好它`, 'apply_bad_json');
  }
  const check = FileSchema.safeParse(parsed);
  if (!check.success) {
    const first = check.error.issues[0];
    throw httpError(
      502,
      `申请数据格式不对：applications.${first.path.join('.') || '?'} —— ${first.message}`,
      'apply_bad_shape',
    );
  }
  return { apps: check.data.applications.map(normalize), sha: data.sha ?? null };
}

/** 读 → 改 → 带 sha 写回。sha 过期（有人同时提交）时重新读取、把我们的状态改动并上去再试 */
async function writeApplications(apps, message, attempts = 3) {
  let list = apps;
  let sha = currentSha;

  for (let i = 0; i < attempts; i++) {
    const body = `${JSON.stringify({ applications: list }, null, 2)}\n`;
    const res = await fetch(contentsUrl(), {
      method: 'PUT',
      headers: { ...ghHeaders(), 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        message,
        content: Buffer.from(body, 'utf8').toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    });

    if (res.ok) {
      cache = { at: 0, data: null };
      return;
    }

    if (res.status === 409 || res.status === 422) {
      // 别人刚提交过（sha 变了）→ 重新读最新版本，把我们改的 status 并上去再写一次
      const again = await fetchApplications();
      sha = again.sha;
      list = applyMerge(list, again.apps);
      continue;
    }
    if (res.status === 404) {
      throw httpError(502, `私有仓库 ${config.applyRepo} 不存在，或 token 没有 Contents 写权限`, 'apply_write');
    }
    throw httpError(502, `写回申请状态失败：GitHub ${res.status}`, 'apply_write');
  }
  throw httpError(502, '申请状态写回失败：并发冲突重试次数用尽', 'apply_conflict');
}

// 写回时的基准 sha（每次读列表时刷新）
let currentSha = null;

/** 冲突重试时：以仓库里的最新版本为准，只保留我们对 status/reviewedAt/reason 的改动 */
function applyMerge(ours, theirs) {
  const byId = new Map(ours.map((a) => [a.id, a]));
  return theirs.map((t) => {
    const o = byId.get(t.id);
    if (!o) return t;
    return { ...t, status: o.status, reviewedAt: o.reviewedAt, reason: o.reason };
  });
}

// ——— 列表缓存（单用户后台；翻来翻去不必每次都打 GitHub）———
let cache = { at: 0, data: null };

/** 审批列表：待审批在前，同状态按提交时间倒序 */
export async function listApplications({ force = false } = {}) {
  if (!config.applyToken) return notConfigured();

  if (!force && cache.data && Date.now() - cache.at < config.applyCacheMs) return cache.data;

  const { apps, sha } = await fetchApplications();
  currentSha = sha;

  const order = { pending: 0, approved: 1, rejected: 2 };
  const items = [...apps].sort(
    (a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
      String(b.submittedAt).localeCompare(String(a.submittedAt)),
  );

  const data = {
    enabled: true,
    repo: config.applyRepo,
    path: config.applyPath,
    items,
    counts: {
      pending: items.filter((a) => a.status === 'pending').length,
      approved: items.filter((a) => a.status === 'approved').length,
      rejected: items.filter((a) => a.status === 'rejected').length,
      total: items.length,
    },
    fetchedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), data };
  return data;
}

/** 侧栏角标用：只要待审批数量（走缓存，不额外打 GitHub） */
export async function applicationsSummary() {
  if (!config.applyToken) return { enabled: false, pending: 0 };
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

/**
 * 通过：① 写进 links.json（进入待发布）→ ② 把 status 写回私有仓库。
 * 顺序很重要：先写 links.json。万一第 ② 步失败，申请还是 pending，
 * 你可以再点一次（links 那边有同名链接去重，不会重复添加）。
 */
export async function approveApplication(id, { force = false } = {}) {
  if (!config.applyToken) throw conflict('没配 ADMIN_APPLY_TOKEN，读不到申请列表');
  const data = await listApplications({ force });
  const app = await findOne(String(id ?? ''), data.items);
  if (app.status === 'approved') throw conflict('这条申请已经通过过了');

  const { friends } = await listLinks();
  if (friends.some((f) => f.url.trim().toLowerCase() === app.url.trim().toLowerCase())) {
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

  const reviewedAt = new Date().toISOString();
  const next = data.items.map((a) => (a.id === app.id ? { ...a, status: 'approved', reviewedAt } : a));
  await writeApplications(next, `审批：通过友链 ${app.name}`);

  cache = { at: 0, data: null };
  await appendLog({
    action: 'approve',
    repo: config.applyRepo,
    application: { id: app.id, name: app.name, url: app.url },
    result: '已写进 links.json（待发布）',
  });

  return { ok: true, application: { ...app, status: 'approved', reviewedAt }, links: await listLinks() };
}

/** 拒绝：把 status 写回私有仓库（可留原因）。对方之后可以重新申请（阶段 B 的去重认这个状态） */
export async function rejectApplication(id, reason = '') {
  if (!config.applyToken) throw conflict('没配 ADMIN_APPLY_TOKEN，读不到申请列表');
  const data = await listApplications({ force: true });
  const app = await findOne(String(id ?? ''), data.items);
  if (app.status === 'rejected') throw conflict('这条申请已经拒绝过了');

  const reviewedAt = new Date().toISOString();
  const note = String(reason ?? '').trim().slice(0, 200);
  const next = data.items.map((a) =>
    a.id === app.id ? { ...a, status: 'rejected', reviewedAt, reason: note || null } : a,
  );
  await writeApplications(next, `审批：拒绝友链 ${app.name}`);

  cache = { at: 0, data: null };
  await appendLog({
    action: 'reject',
    repo: config.applyRepo,
    application: { id: app.id, name: app.name, url: app.url },
    reason: note,
    result: '已标记为拒绝',
  });

  return { ok: true, application: { ...app, status: 'rejected', reviewedAt, reason: note || null } };
}

/** 把某条申请改回「待审批」（点错了能撤回）*/
export async function reopenApplication(id) {
  if (!config.applyToken) throw conflict('没配 ADMIN_APPLY_TOKEN，读不到申请列表');
  const data = await listApplications({ force: true });
  const app = await findOne(String(id ?? ''), data.items);
  const next = data.items.map((a) =>
    a.id === app.id ? { ...a, status: 'pending', reviewedAt: null, reason: null } : a,
  );
  await writeApplications(next, `审批：把友链申请 ${app.name} 改回待审批`);
  cache = { at: 0, data: null };
  await appendLog({
    action: 'reopen',
    repo: config.applyRepo,
    application: { id: app.id, name: app.name },
    result: '已改回待审批',
  });
  return { ok: true, application: { ...app, status: 'pending', reviewedAt: null, reason: null } };
}

/** 仅供测试/自检：清掉列表缓存 */
export function clearApplicationsCache() {
  cache = { at: 0, data: null };
}
