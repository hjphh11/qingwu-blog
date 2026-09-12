// 操作日志（方案第 43 条）：**只记关键操作** —— 发布 / 回滚 / 审批友链。
//
// 存在配置里的 `logPath`（默认 `<仓库>/.admin-logs/`，已 gitignore）：
//   · 它只在服务器上有意义，绝不能进公开仓库（那条路径也在 publish.js 里做了兜底排除）
//   · 一行一条 JSONL：好追加、坏了也只坏一行、出问题能直接用 tail 看
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const LOG_FILE = () => path.join(config.logPath, 'operations.jsonl');

export async function appendLog(entry) {
  await fs.mkdir(path.dirname(LOG_FILE()), { recursive: true });
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  await fs.appendFile(LOG_FILE(), `${line}\n`, 'utf8');
}

/** 最近的日志（新的在前）*/
export async function readLogs(limit = 50) {
  try {
    const text = await fs.readFile(LOG_FILE(), 'utf8');
    return text
      .split('\n')
      .filter((l) => l.trim())
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
  } catch {
    return [];
  }
}
