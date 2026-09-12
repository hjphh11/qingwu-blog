// 友链申请数据的存储层 —— 写进**私有仓库**(不是博客的公开仓库!)。
//
// 为什么不用博客仓库：申请数据含**访客邮箱**，而 `hjphh11/qingwu-blog` 是公开仓库，
// 提交进去会把访客邮箱永久留在公开 git 历史里。所以按项目已有的「题库」模式
// (私有仓库 + 细粒度 PAT) 单独存，后台服务器再 `git pull` 私有仓库读本地文件审批。
//
// 用 GitHub Contents API(读 sha → 改 → 带 sha 写)。并发提交时会 sha 冲突(409/422)，
// 这里做「重新读取 → 重新追加 → 重写」的重试。

export interface Application {
  id: string;
  name: string;
  url: string;
  avatar: string;
  intro: string;
  email: string;
  /** ISO 时间 */
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface ApplyStoreConfig {
  token: string;
  repo: string;
  path: string;
  ref: string;
  /** 便于本地用 mock 服务验证；默认 GitHub 官方 API */
  apiBase?: string;
}

/** 同一邮箱/网站在这个窗口内重复提交会被判定为重复 */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function newApplicationId(now = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `app-${now.toString(36)}-${rand}`;
}

/** 同一站点的比较键：忽略协议、www、大小写、结尾斜杠 */
export function urlKey(raw: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

/**
 * 去重判断(纯函数，便于单测)。
 * 命中即拒绝：防止同一个人反复提交、也顺手挡掉重复刷接口。
 */
export function findDuplicate(
  apps: Application[],
  candidate: { email: string; url: string },
  now = Date.now(),
): { code: 'duplicate'; message: string } | null {
  const email = candidate.email.trim().toLowerCase();
  const key = urlKey(candidate.url);

  for (const a of apps) {
    const sameEmail = a.email.trim().toLowerCase() === email;
    const sameSite = key && urlKey(a.url) === key;
    if (!sameEmail && !sameSite) continue;

    const age = now - new Date(a.submittedAt).getTime();
    const fresh = Number.isFinite(age) && age >= 0 && age < COOLDOWN_MS;

    if (sameSite && a.status !== 'rejected') {
      return { code: 'duplicate', message: '这个站点已经在申请列表里了，我这就去看 ~' };
    }
    if (sameEmail && a.status !== 'rejected') {
      return { code: 'duplicate', message: '这个邮箱的申请已经收到了，不用重复提交 ~' };
    }
    if (fresh) {
      return { code: 'duplicate', message: '刚刚已经收到过你的申请了，稍等我看一下 ~' };
    }
  }
  return null;
}

const ghHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'qingwu-blog',
  'x-github-api-version': '2022-11-28',
});

const contentsUrl = (cfg: ApplyStoreConfig) =>
  `${(cfg.apiBase || 'https://api.github.com').replace(/\/$/, '')}/repos/${cfg.repo}/contents/${cfg.path}`;

/** 读现有申请列表；文件不存在时返回空列表(首次提交要能自动建文件) */
export async function readApplications(
  cfg: ApplyStoreConfig,
): Promise<{ apps: Application[]; sha: string | null }> {
  const res = await fetch(`${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.ref)}`, {
    headers: ghHeaders(cfg.token),
  });

  if (res.status === 404) return { apps: [], sha: null };
  if (!res.ok) {
    throw new Error(`读取申请列表失败：GitHub ${res.status}`);
  }

  const data = (await res.json()) as { content?: string; sha?: string };
  const raw = Buffer.from((data.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  let apps: Application[] = [];
  try {
    const parsed = JSON.parse(raw || '{}');
    if (Array.isArray(parsed?.applications)) apps = parsed.applications;
  } catch {
    throw new Error('申请文件不是合法 JSON，请先修好它再提交');
  }
  return { apps, sha: data.sha ?? null };
}

async function writeApplications(
  cfg: ApplyStoreConfig,
  apps: Application[],
  sha: string | null,
  message: string,
): Promise<void> {
  const body = JSON.stringify({ applications: apps }, null, 2) + '\n';
  const res = await fetch(contentsUrl(cfg), {
    method: 'PUT',
    headers: { ...ghHeaders(cfg.token), 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(body, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
      branch: cfg.ref,
    }),
  });

  if (res.ok) return;

  // 409/422 = sha 过期(有人同时提交)。抛出去让外层重试。
  if (res.status === 409 || res.status === 422) {
    throw new Error('CONFLICT');
  }
  if (res.status === 404) {
    throw new Error(`私有仓库 ${cfg.repo} 不存在，或 PAT 没有该仓库的 Contents 写权限`);
  }
  throw new Error(`写入申请列表失败：GitHub ${res.status}`);
}

/**
 * 读 → 去重 → 追加 → 写。sha 冲突自动重试。
 * 返回 duplicate 时不写仓库。
 */
export async function appendApplication(
  cfg: ApplyStoreConfig,
  candidate: Omit<Application, 'id' | 'submittedAt' | 'status'>,
  opts: { attempts?: number; now?: number } = {},
): Promise<{ ok: true; id: string } | { ok: false; code: 'duplicate'; message: string }> {
  const attempts = opts.attempts ?? 3;
  const now = opts.now ?? Date.now();

  for (let i = 0; i < attempts; i++) {
    const { apps, sha } = await readApplications(cfg);

    const dup = findDuplicate(apps, { email: candidate.email, url: candidate.url }, now);
    if (dup) return { ok: false, code: 'duplicate', message: dup.message };

    const app: Application = {
      id: newApplicationId(now),
      ...candidate,
      submittedAt: new Date(now).toISOString(),
      status: 'pending',
    };

    try {
      await writeApplications(
        cfg,
        [...apps, app],
        sha,
        `申请：友链 ${candidate.name}`,
      );
      return { ok: true, id: app.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'CONFLICT' || i === attempts - 1) throw err;
      // 冲突：等一下再重新读取、重新追加
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }

  throw new Error('写入申请列表失败：并发冲突重试次数用尽');
}
