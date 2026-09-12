// 发布与可靠性（方案 §4.10 + 第 43 条）
//
// 流程：**构建校验 → git add → commit → pull --rebase → push → 触发 Vercel 重建**
//   · 构建不过**直接拒绝推送**（防把站点搞挂）
//   · 提交信息**自动生成**（按改动内容写人话）
//   · pull 冲突时给出明确提示（不静默失败）
//   · 推送用环境变量里的 PAT（**不经命令行参数、不落盘**）
//
// 发布是**异步任务**：POST 之后立刻返回，前端轮询状态看每一步的进度
// （构建要十几秒，同步等会超时，也看不到中间状态）。
import { execFile } from 'node:child_process';
import path from 'node:path';
import { config } from './config.js';
import { changedFiles } from './articles.js';
import { conflict } from './jsonFile.js';
import { appendLog } from './oplog.js';

// 操作日志放在配置里的 logPath（默认 `<仓库>/.admin-logs/`，已 gitignore）
// （读写实现见 oplog.js）

/**
 * 后台自己的运行时目录（操作日志 / 回收站）在仓库内的相对路径。
 * 它们**不该被收进提交**：回收站里可能是从没提交过的私密草稿，日志只在服务器上有意义。
 */
function ownPaths() {
  const out = [];
  for (const p of [config.logPath, config.trashPath]) {
    const rel = path.relative(config.repoPath, p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) out.push(rel.split(path.sep).join('/'));
  }
  return out;
}

/** 给 git 的排除写法（只能用在 `git status` 上，别用在 `git add`，原因见 unstageOwn）*/
function ownExcludes() {
  return ownPaths().map((p) => `:(exclude)${p}`);
}

/**
 * 把后台自己的运行时目录从暂存区摘出去（第二道保险：万一 `.gitignore` 被改坏了，
 * 也不会把日志、回收站里的草稿推到 GitHub 上去）。
 *
 * ⚠️ **不要**图省事写成 `git add -A -- . ':(exclude).admin-logs'`：
 * 当被排除的目录**真的存在且被 .gitignore 忽略**时，git 会打一句
 * “The following paths are ignored…” 并以 **退出码 1** 结束 —— 发布会被误判成「暂存失败」。
 * （2026-09-12 实机踩到：临时测试仓库没写 .gitignore 所以一直是绿的。）
 */
async function unstageOwn() {
  const own = ownPaths();
  if (own.length === 0) return;
  const staged = await git(['diff', '--cached', '--name-only', '--', ...own]);
  if (!staged.ok || staged.out.trim() === '') return;
  await git(['reset', '--quiet', '--', ...own]);
}

/** 跑一条 git 命令；带 token 的凭据助手（只放在子进程环境里，不落盘、不进命令行） */
function git(args, { timeout = 60_000, token = true } = {}) {
  const full = ['-C', config.repoPath, '-c', 'core.quotePath=false'];
  if (token && config.gitToken) {
    // git 会用 sh 执行这个助手；$QW_GIT_TOKEN 在子进程环境里展开
    full.push('-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=$QW_GIT_TOKEN"; }; f');
  }
  full.push(...args);
  return new Promise((resolve) => {
    execFile(
      'git',
      full,
      {
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, QW_GIT_TOKEN: config.gitToken || '', GIT_TERMINAL_PROMPT: '0' },
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err?.code ?? 0,
          out: String(stdout ?? '').trim(),
          err: String(stderr ?? '').trim() || (err ? err.message : ''),
        });
      },
    );
  });
}

/** 跑 npm run build（构建校验）—— 在博客仓库根目录
 *  ⚠️ Windows 上 npm 是 `npm.cmd`，execFile 直接跑会 ENOENT，所以走 shell；
 *     Linux 上 shell 也没问题（命令是我们自己写死的，没有外部输入）。
 *     注意写成「整条命令字符串」而不是 args 数组，否则 Node 22 会报
 *     DEP0190（args + shell 的组合会被警告）。*/
function runBuild() {
  return new Promise((resolve) => {
    execFile(
      'npm run build',
      { cwd: config.repoPath, timeout: 600_000, maxBuffer: 16 * 1024 * 1024, shell: true },
      (err, stdout, stderr) => {
        const text = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
        resolve({ ok: !err, text });
      },
    );
  });
}

/** 自动生成提交信息（第 4 条：提交信息自动生成）*/
export function autoMessage(files) {
  const arts = [];
  const others = { friend: 0, share: 0, category: 0, music: 0, about: 0 };
  for (const f of files) {
    const m = f.file.match(/^src\/content\/blog\/(.+)\.md$/);
    if (m) arts.push({ id: m[1], kind: f.kind });
    else if (f.file === 'src/data/links.json') others.friend++;
    else if (f.file === 'src/data/share.json') others.share++;
    else if (f.file === 'src/data/categories.json') others.category++;
    else if (f.file === 'src/data/music.json' || f.file.startsWith('public/music/lrc/')) others.music++;
    else if (f.file === 'src/data/about.json') others.about++;
  }
  const parts = [];
  if (arts.length === 1) {
    const a = arts[0];
    parts.push(a.kind === 'added' ? `新文章《${a.id}》` : a.kind === 'deleted' ? `删除文章《${a.id}》` : `更新文章《${a.id}》`);
  } else if (arts.length > 1) {
    parts.push(`文章 ${arts.length} 篇`);
  }
  const kindName = { friend: '友链', share: '分享/语录', category: '分类', music: '音乐', about: '关于页' };
  for (const [k, n] of Object.entries(others)) if (n > 0) parts.push(`${kindName[k]}更新`);
  if (parts.length === 0) parts.push(`${files.length} 个文件`);
  return `内容更新：${parts.join(' · ')}`;
}

// ——— 操作日志（第 43 条：只记关键操作）———
// 实现搬到了 oplog.js —— 因为「审批友链」（阶段 J）也要往同一份日志里记。
export { appendLog, readLogs } from './oplog.js';

// ——— 发布任务（单用户后台，同时只允许一个）———
let job = null;

const STEPS = [
  { key: 'build', label: '构建校验' },
  { key: 'add', label: '暂存改动' },
  { key: 'commit', label: '提交' },
  { key: 'pull', label: '拉取变基' },
  { key: 'push', label: '推送' },
  { key: 'deploy', label: '触发重建' },
];

// 回滚走的是同一串步骤，但「暂存改动」其实是「生成 revert」，标题换成人话
const ROLLBACK_LABELS = { add: '生成 revert', commit: '提交 revert' };

function newJob(kind, detail) {
  return {
    kind, // publish | rollback
    detail,
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: null,
    error: '',
    steps: STEPS.map((s) => ({
      ...s,
      label: (kind === 'rollback' && ROLLBACK_LABELS[s.key]) || s.label,
      state: 'pending',
      message: '',
    })),
    log: [],
  };
}

export function currentJob() {
  return job;
}

function step(jobRef, key) {
  const s = jobRef.steps.find((x) => x.key === key);
  if (s) s.state = 'running';
  return {
    ok(message) {
      if (s) {
        s.state = 'ok';
        s.message = message ?? '';
      }
      jobRef.log.push(`✓ ${s?.label ?? key}${message ? `：${message}` : ''}`);
    },
    skip(message) {
      if (s) {
        s.state = 'skip';
        s.message = message ?? '';
      }
      jobRef.log.push(`– ${s?.label ?? key}${message ? `：${message}` : ''}`);
    },
    fail(message) {
      if (s) {
        s.state = 'failed';
        s.message = message ?? '';
      }
      jobRef.log.push(`✗ ${s?.label ?? key}${message ? `：${message}` : ''}`);
    },
  };
}

/** 本机相对远端 origin/main 领先/落后几个提交 */
async function aheadBehind() {
  const r = await git(['rev-list', '--left-right', '--count', 'origin/main...HEAD']);
  if (!r.ok || !/\d+\s+\d+/.test(r.out)) return { ahead: 0, behind: 0 };
  const [behind, ahead] = r.out.split(/\s+/).map(Number);
  return { ahead, behind };
}

/** 发布状态：待发布文件 + 分支/领先落后 + 最近提交 + 是否配了 token/hook */
export async function publishStatus() {
  const [files, branch, ab, recent] = await Promise.all([
    changedFiles(),
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    aheadBehind(),
    git(['log', '--oneline', '-8']),
  ]);
  const count = files ? files.length : 0;
  const branchName = branch.ok ? branch.out : '(未知)';
  // 发布**只推 main**（`push origin HEAD:main`）。如果仓库不在 main 上（例如手动切到了
  // 某个功能分支），推上去等于把那个分支的提交并进 main —— 这种事必须挡住。
  const onMain = branchName === 'main';
  return {
    files: files ?? [],
    count,
    branch: branchName,
    onMain,
    ahead: ab.ahead,
    behind: ab.behind,
    recent: recent.ok ? recent.out.split('\n') : [],
    // 有两种情况可以发：有改动要发；或者上次推送没成功（本地领先远端），这次只把提交推上去
    canPublish: onMain && (count > 0 || ab.ahead > 0) && config.gitToken !== '',
    canRetryPush: ab.ahead > 0,
    hasToken: config.gitToken !== '',
    hasDeployHook: config.deployHook !== '',
    job,
  };
}

/** 发布历史（最近几次提交，供回滚选）
 *  `isRoot` 标出仓库的第一个提交 —— 它没有父提交，`git revert` 回滚不了，前端要把按钮禁掉。*/
export async function history() {
  const [r, root] = await Promise.all([
    git(['log', '--pretty=format:%H|%h|%ad|%s', '--date=format:%Y-%m-%d %H:%M', '-12']),
    git(['rev-list', '--max-parents=0', 'HEAD']),
  ]);
  if (!r.ok) return [];
  const roots = new Set(root.out.split('\n').map((s) => s.trim()).filter(Boolean));
  return r.out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, short, date, ...rest] = line.split('|');
      return { hash, short, date, subject: rest.join('|'), isRoot: roots.has(hash) };
    });
}

/** 触发 Vercel 重建（没配 Deploy Hook 就跳过）*/
async function triggerDeploy() {
  if (!config.deployHook) return { ok: true, skipped: true, message: '没配 Deploy Hook（Vercel 会自己检测到 push 后重建）' };
  try {
    const res = await fetch(config.deployHook, { method: 'POST' });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, message: res.ok ? `已触发重建（HTTP ${res.status}）` : `触发失败 HTTP ${res.status} ${text.slice(0, 120)}` };
  } catch (err) {
    return { ok: false, message: `触发重建失败：${err.message}` };
  }
}

/** 真正的发布流程（异步跑）*/
async function runPublish(jobRef, { paths = null }) {
  const t = (k) => step(jobRef, k);
  try {
    // ① 构建校验
    let s = t('build');
    jobRef.log.push('正在跑 npm run build（构建不过就不会推送）…');
    const b = await runBuild();
    if (!b.ok) {
      const tail = b.text.split('\n').slice(-12).join('\n');
      s.fail('构建失败 —— 已中止，没有推送');
      jobRef.log.push(tail);
      jobRef.ok = false;
      jobRef.error = '构建校验没通过，已拒绝推送。请看下面的日志。';
      return;
    }
    s.ok('构建通过');

    // ② 暂存
    s = t('add');
    const addArgs = paths && paths.length > 0 ? ['add', '--', ...paths] : ['add', '-A'];
    const a = await git(addArgs);
    if (!a.ok) {
      s.fail(a.err.slice(0, 300));
      jobRef.ok = false;
      jobRef.error = '暂存失败';
      return;
    }
    await unstageOwn();
    const staged = await git(['diff', '--cached', '--name-only']);
    const stagedFiles = staged.out.split('\n').filter(Boolean);
    // 没有新改动也允许继续：这是「上次推送没成功，把本地的提交重新推上去」
    // （断网、仓库权限被拒都会走到这里；否则用户会卡在「待发布 0 个文件」上没法重试）
    const retryOnly = stagedFiles.length === 0;
    if (retryOnly) s.skip('没有新改动（这次只把之前没推上去的提交推上去）');
    else s.ok(`${stagedFiles.length} 个文件`);

    // ③ 提交（信息自动生成）
    s = t('commit');
    const head0 = await git(['rev-parse', 'HEAD']);
    let msg = '';
    if (retryOnly) {
      s.skip('没有新改动要提交');
    } else {
      // 提交信息只按**这次真正提交的文件**写（只发布勾选的那几个时，别把没提交的也算进去）
      const stagedSet = new Set(stagedFiles);
      const all = (await changedFiles()) ?? [];
      const picked = all.filter((f) => stagedSet.has(f.file));
      msg = autoMessage(picked.length > 0 ? picked : all);
      const c = await git(['commit', '-m', msg], { timeout: 60_000 });
      if (!c.ok) {
        s.fail(c.err.slice(0, 300));
        jobRef.ok = false;
        jobRef.error = '提交失败（可能是 git 身份没配）';
        return;
      }
      s.ok(msg);
      jobRef.commit = msg;
    }

    // ④ pull --rebase
    //    冲突时：先 abort，再把这次自动提交用 `reset --soft` 退回去。
    //    **必须退**：留着一个没推上去的本地提交，会让「待发布」显示 0 个文件、
    //    再点发布又说没有可提交的改动 —— 用户就卡死了。`--soft` 能保证改动仍在工作区。
    //
    //    `--autostash`：只发布勾选的几个文件时，**没勾选的那些改动还留在工作区**，
    //    git 平时会直接甩一句「cannot pull with rebase: You have unstaged changes」不让拉；
    //    加上 autostash 会先临时收起来、拉完再放回去（不会丢）。
    //    顺带也解决「日志文件万一被 git 跟踪了，后台自己写日志把工作区弄脏」的情况。
    s = t('pull');
    const p = await git(['pull', '--rebase', '--autostash'], { timeout: 180_000 });
    if (!p.ok) {
      await git(['rebase', '--abort']).catch(() => {});
      let undone = false;
      if (!retryOnly && head0.ok && head0.out) undone = (await git(['reset', '--soft', head0.out])).ok;
      const back = retryOnly
        ? '本地那个提交还在，网络好了再点一次重试推送'
        : undone
          ? '已退回这次提交（改动仍在「待发布」里，没丢）'
          : '已回退 rebase，但自动提交没能退回去';
      s.fail(`拉取时发生冲突 —— ${back}`);
      jobRef.log.push(p.err.split('\n').slice(0, 12).join('\n'));
      jobRef.ok = false;
      jobRef.error = '远端有新提交且和本地改动冲突。你的改动都还在，也没有强行推送 —— 请先手动解决冲突（或告诉我改了什么），再发一次。';
      return;
    }
    s.ok(p.out.split('\n').slice(-1)[0] || '已同步');

    // ⑤ push
    s = t('push');
    const push = await git(['push', 'origin', 'HEAD:main'], { timeout: 180_000 });
    if (!push.ok) {
      s.fail(push.err.slice(0, 300));
      jobRef.log.push(push.err.split('\n').slice(0, 12).join('\n'));
      jobRef.ok = false;
      // 本地提交**留着**：内容已经安全落库，只是没推上去；
      // 界面上会显示「本地有 N 个提交还没推上去」，点「重试推送」就能补推。
      jobRef.error = '推送失败（网络或权限问题）。改动已经安全提交在本地了 —— 回去点「重试推送」再试一次即可。';
      return;
    }
    s.ok('已推送');

    // ⑥ 触发重建
    s = t('deploy');
    const d = await triggerDeploy();
    if (d.skipped) s.skip(d.message);
    else if (d.ok) s.ok(d.message);
    else s.fail(d.message);

    jobRef.ok = true;
    await appendLog({
      action: 'publish',
      files: stagedFiles,
      commit: msg,
      result: retryOnly ? '重试推送成功' : d.skipped ? '已推送（未配 hook）' : d.message,
    });
  } catch (err) {
    jobRef.ok = false;
    jobRef.error = err.message;
    jobRef.log.push(`✗ 意外错误：${err.message}`);
  } finally {
    jobRef.running = false;
    jobRef.finishedAt = new Date().toISOString();
  }
}

/** 开始发布（立刻返回，前端轮询状态）
 *  两种情况都能发：① 有改动要发布；② 本地领先远端（上次推送失败）—— 这时是「重试推送」。*/
export async function startPublish(opts = {}) {
  if (job?.running) throw conflict('上一次发布还没结束，等它跑完再发');
  // 没配 token 就别开始：不然会 commit 出一个推不上去的本地提交，反而把仓库搞乱
  // （界面上按钮本来就是灰的；定时发布那条路也得挡住）
  if (!config.gitToken) {
    throw conflict('没配 ADMIN_GIT_TOKEN —— 现在只能保存内容，不能发布（发布要推 GitHub）');
  }
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.ok && branch.out !== 'main') {
    throw conflict(`仓库现在在 ${branch.out} 分支上；发布只会推 main，请先切回 main 再发`);
  }
  const files = (await changedFiles()) ?? [];
  // 勾选发布：**只认确实在待发布清单里的路径**。接口不信前端传来的字符串 ——
  // 顺手把 pathspec 魔法（`:!xxx`）、仓库外的路径、以及已经不存在的东西全挡掉。
  const asked = Array.isArray(opts.paths) ? opts.paths : null;
  const pendingSet = new Set(files.map((f) => f.file));
  const picked = asked ? asked.filter((p) => pendingSet.has(p)) : [];
  if (asked && asked.length > 0 && picked.length === 0) {
    throw conflict('勾选的文件已经不在待发布列表里了，刷新页面再试');
  }
  const paths = picked.length > 0 ? picked : null;

  const { ahead } = await aheadBehind();
  if (files.length === 0 && ahead === 0) throw conflict('没有待发布的改动');
  const retryOnly = files.length === 0;
  job = newJob(
    'publish',
    retryOnly
      ? `重试推送 ${ahead} 个提交`
      : paths
        ? `发布选中的 ${paths.length} 个文件`
        : '一键全发',
  );
  job.requestedPaths = paths;
  runPublish(job, { paths }).catch((err) => {
    job.ok = false;
    job.error = err.message;
    job.running = false;
  });
  return job;
}

/** 回滚：把某次提交 revert 掉，再走一遍 构建 → 提交 → 推送 */
async function runRollback(jobRef, commit) {
  const t = (k) => step(jobRef, k);
  try {
    let s = t('build');
    // 「干净」按 git 自己的口径算，但**排掉后台自己的日志/回收站目录** ——
    // 那是后台在跑的时候自己写的，不该挡着回滚。
    const cur = await git(['status', '--porcelain', '--', '.', ...ownExcludes()]);
    if (!cur.ok || cur.out.trim() !== '') {
      s.fail('工作区还有没提交的改动，先发布或还原它们再回滚');
      jobRef.ok = false;
      jobRef.error = '工作区不干净，回滚会影响这些改动';
      return;
    }
    s.ok('工作区干净');

    // 回滚前先记住原位置：中途失败要能**整体还原**（回滚是机器生成的提交，
    // 工作区开头也校验过是干净的，所以还原不会丢用户的东西，重试也是幂等的）
    const head0 = await git(['rev-parse', 'HEAD']);

    s = t('add');
    const rv = await git(['revert', '--no-edit', commit], { timeout: 120_000 });
    if (!rv.ok) {
      await git(['revert', '--abort']).catch(() => {});
      s.fail(rv.err.slice(0, 300));
      jobRef.ok = false;
      jobRef.error = 'revert 失败（可能冲突）';
      return;
    }
    s.ok(`已 revert ${commit.slice(0, 7)}`);

    s = t('commit');
    s.ok('revert 已生成提交');

    s = t('pull');
    const p = await git(['pull', '--rebase', '--autostash'], { timeout: 180_000 });
    if (!p.ok) {
      await git(['rebase', '--abort']).catch(() => {});
      // 用 `--keep` 而不是 `--hard`：万一工作区还有别的手改文件，宁可不还原也不能删掉它们
      if (head0.ok && head0.out) await git(['reset', '--keep', head0.out]);
      s.fail(`拉取失败 —— 已还原到回滚前的状态`);
      jobRef.log.push(p.err.split('\n').slice(0, 12).join('\n'));
      jobRef.ok = false;
      jobRef.error = '拉取没成功（远端有新提交或网络不通），已还原到回滚前的样子，没有强推';
      return;
    }
    s.ok('已同步');

    s = t('push');
    const push = await git(['push', 'origin', 'HEAD:main'], { timeout: 180_000 });
    if (!push.ok) {
      if (head0.ok && head0.out) await git(['reset', '--keep', head0.out]);
      s.fail(push.err.slice(0, 300));
      jobRef.log.push(push.err.split('\n').slice(0, 12).join('\n'));
      jobRef.ok = false;
      jobRef.error = '推送失败，已还原到回滚前的状态，可以重试';
      return;
    }
    s.ok('已推送');

    s = t('deploy');
    const d = await triggerDeploy();
    if (d.skipped) s.skip(d.message);
    else if (d.ok) s.ok(d.message);
    else s.fail(d.message);

    jobRef.ok = true;
    await appendLog({ action: 'rollback', commit, result: '已回滚并推送' });
  } catch (err) {
    jobRef.ok = false;
    jobRef.error = err.message;
    jobRef.log.push(`✗ 意外错误：${err.message}`);
  } finally {
    jobRef.running = false;
    jobRef.finishedAt = new Date().toISOString();
  }
}

export async function startRollback(commit) {
  if (job?.running) throw conflict('上一次发布还没结束');
  if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit)) throw conflict('提交号不合法');
  job = newJob('rollback', `回滚 ${commit.slice(0, 7)}`);
  runRollback(job, commit).catch((err) => {
    job.ok = false;
    job.error = err.message;
    job.running = false;
  });
  return job;
}
