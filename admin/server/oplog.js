// 操作日志（方案第 43 条）：**只记关键操作** —— 发布 / 回滚 / 审批友链 / 定时发布。
//
// 存在配置里的 `logPath`（默认 `<仓库>/.admin-logs/`，已 gitignore）：
//   · 它只在服务器上有意义，绝不能进公开仓库（那条路径也在 publish.js 里做了兜底排除）
//   · 一行一条 JSONL：好追加、坏了也只坏一行、出问题能直接用 tail 看
//
// 阶段 N 收尾：**加了轮转**。以前这个文件只增不减，用几年会越来越大，而且每次读都要全量
// parse 进内存。现在超过 MAX_BYTES 就只保留最新 KEEP_LINES 行（原子替换），读也只读文件尾部。
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const LOG_FILE = () => path.join(config.logPath, 'operations.jsonl');
/** 超过这个大小就轮转（512KB 能放几千条关键操作，够回溯很久了）*/
const MAX_BYTES = 512 * 1024;
/** 轮转时至少保留多少行（哪怕行很长也留这么多，免得文件被裁空）*/
const MIN_KEEP_LINES = 200;

export async function appendLog(entry) {
  await fs.mkdir(path.dirname(LOG_FILE()), { recursive: true });
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  await fs.appendFile(LOG_FILE(), `${line}\n`, 'utf8');
  // 轮转失败不能影响「记日志」这件事本身
  await rotateIfNeeded().catch((err) => console.warn('[admin] 操作日志轮转失败（不影响使用）:', err.message));
}

/**
 * 太大了就裁掉老的。保留策略是**按字节预算**从最新往回留 ——
 * 只按「行数」留的话，遇到特别长的行（比如一次发布列了几十个文件）文件会仍然超过上限，
 * 于是每追加一条都要重写整份文件。
 */
async function rotateIfNeeded() {
  const file = LOG_FILE();
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return;
  }
  if (stat.size <= MAX_BYTES) return;

  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim());

  const kept = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const size = Buffer.byteLength(lines[i], 'utf8') + 1;
    if (kept.length >= MIN_KEEP_LINES && bytes + size > MAX_BYTES) break;
    kept.push(lines[i]);
    bytes += size;
  }
  kept.reverse();

  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
  await fs.rename(tmp, file);
  console.log(
    `[admin] 操作日志已轮转：${lines.length} 条 / ${Math.round(stat.size / 1024)}KB → ` +
      `${kept.length} 条 / ${Math.round(bytes / 1024)}KB`,
  );
}

/**
 * 最近的日志（新的在前）。
 * ⚠️ 只读文件**尾部**：日志可能很大，全量读进来既慢又占内存。
 */
export async function readLogs(limit = 50) {
  const file = LOG_FILE();
  let text = '';
  try {
    const fh = await fs.open(file, 'r');
    try {
      const { size } = await fh.stat();
      // 一条日志撑死几百字节，多读一些以保证够 limit 条
      const bytes = Math.min(size, Math.max(64 * 1024, limit * 512));
      const buf = Buffer.alloc(bytes);
      await fh.read(buf, 0, bytes, size - bytes);
      text = buf.toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return []; // 还没有日志文件
  }

  const lines = text.split('\n').filter((l) => l.trim());
  // 从尾部读可能把第一行截断，索性丢掉最前面那条（宁可少一条，也不要一条坏 JSON）
  if (lines.length > limit) lines.splice(0, lines.length - limit);
  return lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse()
    .slice(0, limit);
}
