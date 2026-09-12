// 定时发布（阶段 K · 方案 §4.12）：到点由服务器自动跑一遍发布流程。
//
// 存在哪：`<logPath>/schedule.json`（在 `.admin-logs/` 里，已 gitignore）。
//   为什么不写进仓库：这是**后台自己的待办**，不是内容；写进去会污染博客的提交历史。
//   代价是服务器重装会丢待办 —— 但待办本身就是「内容已经在仓库里、只是等一个时间点」，
//   丢了顶多是没按时发，改动还在「待发布」里，手动点一下就补上了。
//
// 到点做什么：
//   · 有 `articleId` 时：先把那篇**草稿**改成已发布（如果它还是草稿），再发布它 → 就是「定时上线」
//   · 没写 articleId 时：把当时**所有待发布改动**一起发出去
//
// 进程重启后，**过期的待办会在启动后 20 秒内补跑**（服务器半夜重启也不会漏掉）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { badRequest, conflict } from './jsonFile.js';
import { appendLog } from './oplog.js';
import { readArticle, updateArticle, changedFiles } from './articles.js';
import { currentJob, startPublish } from './publish.js';

const FILE = () => path.join(config.logPath, 'schedule.json');
const TICK_MS = 15_000;

const JobSchema = z.object({
  id: z.string(),
  at: z.string(), // ISO
  articleId: z.string().nullish(),
  note: z.string().max(120).nullish(),
  createdAt: z.string(),
  state: z.enum(['pending', 'running', 'done', 'failed', 'canceled']).default('pending'),
  result: z.string().nullish(),
  finishedAt: z.string().nullish(),
});
const FileSchema = z.object({ jobs: z.array(JobSchema).default([]) });

let cache = null;
let timer = null;

async function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await fs.readFile(FILE(), 'utf8'));
    const parsed = FileSchema.safeParse(raw);
    cache = parsed.success ? parsed.data : { jobs: [] };
  } catch {
    cache = { jobs: [] }; // 文件不存在 / 坏了都当作空待办（宁可少一个待办，也别让后台起不来）
  }
  return cache;
}

async function save(data) {
  await fs.mkdir(path.dirname(FILE()), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, FILE()); // 原子写：别让半个 JSON 落在盘上
  cache = data;
}

/** 列出待办（新时间在前）*/
export async function listSchedule() {
  const { jobs } = await load();
  return {
    jobs: [...jobs].sort((a, b) => String(a.at).localeCompare(String(b.at))),
    serverTime: new Date().toISOString(),
    tickMs: TICK_MS,
  };
}

/** 加一个待办：{ at: ISO 字符串 或 'YYYY-MM-DDTHH:mm', articleId?, note? } */
export async function addSchedule(input = {}) {
  const atRaw = String(input.at ?? '').trim();
  if (!atRaw) throw badRequest('要给出发布时间');
  const at = new Date(atRaw);
  if (Number.isNaN(at.getTime())) throw badRequest(`看不懂这个时间：${atRaw}`);
  if (at.getTime() < Date.now() - 60_000) throw badRequest('这个时间已经过去了（服务器时间是即时生效的，选个将来的时间吧）');

  const data = await load();
  const articleId = input.articleId ? String(input.articleId) : null;
  if (articleId) {
    const a = await readArticle(articleId).catch(() => null);
    if (!a) throw badRequest(`找不到文章 ${articleId}`);
  }
  const job = {
    id: `sch-${randomUUID().slice(0, 8)}`,
    at: at.toISOString(),
    articleId,
    note: String(input.note ?? '').trim().slice(0, 120) || null,
    createdAt: new Date().toISOString(),
    state: 'pending',
    result: null,
    finishedAt: null,
  };
  await save({ jobs: [...data.jobs, job] });
  return { job, ...(await listSchedule()) };
}

/** 取消一个待办（已经在跑的取消不了）*/
export async function cancelSchedule(id) {
  const data = await load();
  const job = data.jobs.find((j) => j.id === id);
  if (!job) throw badRequest('找不到这个待办');
  if (job.state === 'running') throw conflict('这一条正在发布，等它跑完再说');
  const next = data.jobs.map((j) => (j.id === id ? { ...j, state: 'canceled', finishedAt: new Date().toISOString() } : j));
  await save({ jobs: next });
  return listSchedule();
}

/** 删掉历史记录（只删 done/failed/canceled）*/
export async function clearFinished() {
  const data = await load();
  await save({ jobs: data.jobs.filter((j) => j.state === 'pending' || j.state === 'running') });
  return listSchedule();
}

async function mark(id, patch) {
  const data = await load();
  await save({ jobs: data.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) });
}

/** 执行一个到点的待办 */
async function runJob(job) {
  await mark(job.id, { state: 'running' });
  try {
    // ① 如果指定了文章：草稿 → 已发布（这就是「到点上线」）
    //    注意要把 readArticle 的字段**映射回编辑器的入参形状**（它是 pubDateText，接口要 pubDate/slug）
    if (job.articleId) {
      const a = await readArticle(job.articleId).catch(() => null);
      if (a && a.draft) {
        await updateArticle(job.articleId, {
          title: a.title,
          slug: job.articleId,
          category: a.category,
          pubDate: a.pubDateText,
          tags: a.tags ?? [],
          description: a.description ?? '',
          draft: false,
          pinned: a.pinned === true,
          ...(a.pinned && typeof a.pinOrder === 'number' ? { pinOrder: a.pinOrder } : {}),
          body: a.body ?? '',
        });
      }
    }

    // ② 没东西可发就别假装发了
    const files = (await changedFiles()) ?? [];
    if (files.length === 0) {
      await mark(job.id, {
        state: 'failed',
        result: '到点了，但当时没有待发布的改动（可能已经手动发过了）',
        finishedAt: new Date().toISOString(),
      });
      await appendLog({ action: 'publish-scheduled', schedule: job.id, result: '跳过：没有待发布改动' });
      return;
    }

    // ③ 跑发布流程（和手点「发布」完全同一条路：构建校验 → 提交 → 拉取 → 推送）
    if (currentJob()?.running) {
      await mark(job.id, {
        state: 'failed',
        result: '到点时正好有另一个发布任务在跑，这次没执行（改动还在待发布里，手动发一下即可）',
        finishedAt: new Date().toISOString(),
      });
      await appendLog({ action: 'publish-scheduled', schedule: job.id, result: '跳过：已有发布任务在跑' });
      return;
    }
    const created = await startPublish({ paths: job.articleId ? files.map((f) => f.file) : null });

    // 等它跑完（构建要十几秒），把结果记在待办上
    const ok = await waitJob(created, 15 * 60_000);
    await mark(job.id, {
      state: ok ? 'done' : 'failed',
      result: ok ? `已定时发布：${created.commit || '（提交信息见发布页）'}` : created.error || '发布失败',
      finishedAt: new Date().toISOString(),
    });
    await appendLog({
      action: 'publish-scheduled',
      schedule: job.id,
      articleId: job.articleId ?? null,
      result: ok ? `已发布：${created.commit || ''}` : `失败：${created.error || ''}`,
    });
  } catch (err) {
    await mark(job.id, { state: 'failed', result: err.message, finishedAt: new Date().toISOString() });
    await appendLog({ action: 'publish-scheduled', schedule: job.id, result: `失败：${err.message}` });
  }
}

function waitJob(job, timeout) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (!job.running) {
        clearInterval(tick);
        resolve(job.ok === true);
      } else if (Date.now() - t0 > timeout) {
        clearInterval(tick);
        resolve(false);
      }
    }, 1000);
  });
}

/** 一次「到点检查」（导出给测试用；正常由 startScheduler 的定时器调用）*/
export async function tick(now = Date.now()) {
  const data = await load();
  const due = data.jobs.filter((j) => j.state === 'pending' && new Date(j.at).getTime() <= now);
  for (const job of due) await runJob(job);
  return due.length;
}

/** 启动定时器（index.js 启动时调一次）*/
export function startScheduler() {
  if (timer) return;
  // 启动后先等 20 秒：给服务器重启、代码更新留点缓冲，别一上来就发布
  setTimeout(() => {
    tick().catch(() => {});
    timer = setInterval(() => tick().catch(() => {}), TICK_MS);
    if (timer.unref) timer.unref();
  }, 20_000).unref?.();
}
