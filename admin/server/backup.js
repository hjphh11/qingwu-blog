// 一键导出备份（阶段 K · 方案 §4.15）：把**全部内容**打包成一个 zip 下载。
//
// 打包范围（都是「内容」，不含代码 —— 代码在 git 里，备份它没意义）：
//   · src/content/blog/*.md      文章
//   · src/data/*.json            分类 / 友链 / 分享 / 关于页 / 音乐元数据
//   · src/data/music.ts          由 gen.mjs 从 music.json + lrc 生成（带上，恢复后可直接构建）
//   · public/music/lrc/*.lrc     歌词
//   · MANIFEST.json              备份时间 / 提交号 / 每个文件的大小与 sha256（用于核对完整性）
//   · 恢复说明.md                怎么还原（照做就能回到备份时的状态）
//
// 「可完整还原」是这一阶段的验收标准，所以 ZIP 是自己按格式写的（见 zip.js），
// 并且在测试里真的解压出来跟仓库逐字节比对。
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { makeZip } from './zip.js';

/** 要打包的目录（相对仓库根）*/
const INCLUDE_DIRS = [
  ['src/content/blog', ['.md']],
  ['src/data', ['.json', '.ts']],
  ['public/music/lrc', ['.lrc']],
];

async function listFiles(dir, exts) {
  let names = [];
  try {
    names = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of names) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full, exts)));
    else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

/** 当前提交号（拿不到就写 'unknown'，不影响备份可用）*/
function headCommit() {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', config.repoPath, 'rev-parse', '--short', 'HEAD'],
      { timeout: 10_000 },
      (err, stdout) => resolve(err ? 'unknown' : String(stdout).trim()),
    );
  });
}

const RESTORE_README = `# 清吾内容备份 · 恢复说明

这个 zip 是后台「一键导出备份」生成的，里面是**内容**（文章 / 数据 / 歌词），不含代码。

## 怎么恢复

1. 解压到任意目录，你会看到 \`src/\` 和 \`public/\` 两棵目录树，结构与博客仓库一致。
2. 在博客仓库里覆盖回去（**先确认工作区干净**，必要时先 \`git stash\`）：

   \`\`\`bash
   # macOS / Linux
   unzip -o 备份.zip -d /tmp/qw-backup
   cd /path/to/qingwu-blog
   git status --short                 # 应为空
   cp -a /tmp/qw-backup/src/data/.        src/data/
   cp -a /tmp/qw-backup/src/content/.     src/content/
   cp -a /tmp/qw-backup/public/music/.    public/music/
   git status --short                 # 看看改了哪些，确认无误再提交
   \`\`\`

   Windows（PowerShell）：

   \`\`\`powershell
   Expand-Archive 备份.zip -DestinationPath $env:TEMP\\qw-backup -Force
   Copy-Item -Recurse -Force "$env:TEMP\\qw-backup\\src\\data\\*"      src\\data\\
   Copy-Item -Recurse -Force "$env:TEMP\\qw-backup\\src\\content\\*"   src\\content\\
   Copy-Item -Recurse -Force "$env:TEMP\\qw-backup\\public\\music\\*"  public\\music\\
   \`\`\`

3. 跑一次构建确认没坏：\`npm run build\`
4. 提交并推送（或者直接在后台点「发布」）。

## 核对完整性

\`MANIFEST.json\` 里列了每个文件的 \`bytes\` 与 \`sha256\`，可以用它确认解压出来的文件和备份时一模一样：

\`\`\`bash
# 例如比对 src/data/links.json
sha256sum src/data/links.json
# 与 MANIFEST.json 里 files["src/data/links.json"].sha256 对照
\`\`\`
`;

/** 生成备份 zip：返回 { buf, name, files, manifest } */
export async function buildBackup(opts = {}) {
  const rows = [];
  for (const [rel, exts] of INCLUDE_DIRS) {
    for (const full of await listFiles(path.join(config.repoPath, rel), exts)) {
      const data = await fs.readFile(full);
      const relPath = path.relative(config.repoPath, full).split(path.sep).join('/');
      rows.push({ path: relPath, data });
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));

  const commit = await headCommit();
  const manifest = {
    app: '清吾后台 · 一键导出备份',
    createdAt: new Date().toISOString(),
    repo: config.repoPath,
    commit,
    branch: null,
    count: rows.length,
    files: Object.fromEntries(
      rows.map((r) => [
        r.path,
        { bytes: r.data.length, sha256: crypto.createHash('sha256').update(r.data).digest('hex').slice(0, 16) },
      ]),
    ),
  };

  const entries = [
    { name: 'MANIFEST.json', data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: '恢复说明.md', data: RESTORE_README },
    ...rows.map((r) => ({ name: r.path, data: r.data })),
  ];

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return {
    buf: makeZip(entries, opts),
    name: `qingwu-backup-${stamp}.zip`,
    files: rows.map((r) => r.path),
    manifest,
  };
}
