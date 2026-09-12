// 回收站：**所有类型的软删除**都存这里（文章 / 友链 / 分享条目…）。
//
// 一条一个 JSON 文件，命名 `<type>--<key>--<时间戳>.json`，里面存：
//   { type, key, originalPath, deletedAt, note, data, body }
// 「恢复」由调用方按 type 分派（见 routes/trash.js），这样各模块自己知道怎么还原，
// 也避免模块之间循环 import。
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { badRequest, notFound } from './jsonFile.js';

const TRASH_DIR = () => config.trashPath;

const ENTRY_RE = /^[a-z]+--[A-Za-z0-9._\u4e00-\u9fa5-]+--[0-9TZ:.-]+\.json$/;

export function trashEntryPath(entry) {
  if (typeof entry !== 'string' || !ENTRY_RE.test(entry)) throw badRequest('回收站条目名不合法');
  const dir = TRASH_DIR();
  const full = path.join(dir, entry);
  const rel = path.relative(dir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw badRequest('回收站路径越界');
  }
  return full;
}

/** 放进回收站，返回条目名 */
export async function putToTrash({ type, key, originalPath, data, body = null, note = '' }) {
  await fs.mkdir(TRASH_DIR(), { recursive: true });
  const safeKey = String(key).replace(/[^\w.\u4e00-\u9fa5-]+/g, '-') || 'item';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const entry = `${type}--${safeKey}--${stamp}.json`;
  const payload = {
    type,
    key,
    originalPath,
    deletedAt: new Date().toISOString(),
    note,
    data,
    body,
  };
  await fs.writeFile(trashEntryPath(entry), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return entry;
}

/** 列表（新的在前），带一个给人看的标题 */
export async function listTrash() {
  const dir = TRASH_DIR();
  let files;
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const obj = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      out.push({
        entry: f,
        type: obj.type,
        key: obj.key,
        title: obj.data?.title ?? obj.data?.name ?? obj.data?.text ?? obj.key,
        note: obj.note ?? '',
        deletedAt: obj.deletedAt,
        originalPath: obj.originalPath ?? '',
      });
    } catch {
      /* 坏条目跳过 */
    }
  }
  out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return out;
}

export async function readTrashEntry(entry) {
  const file = trashEntryPath(entry);
  try {
    return { entry, ...JSON.parse(await fs.readFile(file, 'utf8')) };
  } catch {
    throw notFound('回收站里没有这一条');
  }
}

/** 彻底清除（不可恢复）*/
export async function purgeTrash(entry) {
  const file = trashEntryPath(entry);
  try {
    await fs.access(file);
  } catch {
    throw notFound('回收站里没有这一条');
  }
  await fs.rm(file, { force: true });
  return { ok: true };
}
