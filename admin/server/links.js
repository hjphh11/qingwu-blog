// 友链管理（方案 §4.4 + 第 34 条）。
//
// 数据本体是 `src/data/links.json` 的 `friends` 数组。
// 第 34 条：`visible`（是否显示）与 `addedAt`（添加时间）**只在后台用，前台不受影响**
// （前台 /links 照旧全渲染 —— 阶段 G 的构建产物比对确认过 /links 页逐字节没变）。
//
// 设计：**整表保存**。后台把整个 friends 数组 PUT 回来（新增/修改/排序都在一次保存里），
// 只有「删除」是单独接口，因为它要走回收站（软删除）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { badRequest, conflict, readJsonFile, writeJsonFile } from './jsonFile.js';
import { putToTrash } from './trash.js';

const LINKS_FILE = () => path.join(config.repoPath, 'src', 'data', 'links.json');

const urlLike = z.string().trim().min(1, '不能为空');

const FriendSchema = z.object({
  name: z.string().trim().min(1, '名字不能为空').max(40, '名字最多 40 字'),
  avatar: urlLike.max(300, '头像链接太长'),
  intro: z.string().max(120, '介绍最多 120 字'),
  url: urlLike.max(300, '链接太长'),
  visible: z.boolean().default(true),
  // 列表接口会给老数据补 `null`（老 friends 没有这个字段），
  // 前端原样回传时就是 null —— 所以这里要接受 null（nullish = string | null | undefined）
  addedAt: z.string().nullish(),
});

const LinksSchema = z.object({ friends: z.array(FriendSchema) });

export async function readLinks() {
  const data = await readJsonFile(LINKS_FILE());
  const parsed = LinksSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(
      `links.json 结构不对：${first.path.join('.') || '(根)'} —— ${first.message}`,
      'bad_links_file',
    );
  }
  return parsed.data;
}

/** 列表（原样顺序 = 前台展示顺序）。补上 visible / addedAt 的稳定形状
 *  （老数据没有 addedAt，这里给 null；保存时会自动补当天） */
export async function listLinks() {
  const { friends } = await readLinks();
  return {
    friends: friends.map((f) => ({
      ...f,
      visible: f.visible !== false,
      addedAt: f.addedAt ?? null,
    })),
    count: friends.length,
    hidden: friends.filter((f) => f.visible === false).length,
  };
}

function assertNoDupUrl(friends, skipIndex = -1) {
  const seen = new Map();
  friends.forEach((f, i) => {
    if (i === skipIndex) return;
    const key = f.url.trim().toLowerCase();
    if (seen.has(key)) {
      throw conflict(`「${f.name}」和「${friends[seen.get(key)].name}」的链接是同一个，请去重`);
    }
    seen.set(key, i);
  });
}

/**
 * 整表保存：新增 / 修改 / 排序都在这里。
 * 新条目的 `addedAt` 自动记今天；已有条目保留原来的 addedAt（除非显式传）。
 */
export async function saveLinks(input) {
  const parsed = LinksSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(`${first.path.join('.') || '(根)'}：${first.message}`, 'validation');
  }
  const friends = parsed.data.friends;
  assertNoDupUrl(friends);

  const before = (await readLinks()).friends;
  const beforeByUrl = new Map(before.map((f) => [f.url.trim().toLowerCase(), f]));
  const today = new Date().toISOString().slice(0, 10);

  const next = friends.map((f) => {
    const old = beforeByUrl.get(f.url.trim().toLowerCase());
    const addedAt = f.addedAt || old?.addedAt || today;
    return { ...f, visible: f.visible !== false, addedAt };
  });

  await writeJsonFile(LINKS_FILE(), { friends: next });
  return listLinks();
}

/** 删除一条友链 → 进回收站（软删除）*/
export async function deleteLink(url) {
  const target = String(url ?? '').trim();
  if (!target) throw badRequest('需要给出要删除的友链链接');
  const { friends } = await readLinks();
  const idx = friends.findIndex((f) => f.url.trim().toLowerCase() === target.toLowerCase());
  if (idx === -1) throw badRequest('这条友链不存在');

  const item = friends[idx];
  const entry = await putToTrash({
    type: 'friend',
    key: item.name || item.url,
    originalPath: `src/data/links.json#friends[${idx}]`,
    data: item,
    note: '删除友链',
  });
  const next = friends.filter((_, i) => i !== idx);
  await writeJsonFile(LINKS_FILE(), { friends: next });
  return { ok: true, entry, name: item.name, friends: next };
}

/** 从回收站还原一条友链（接在列表末尾）*/
export async function restoreFriendFromTrash(obj) {
  const { friends } = await readLinks();
  const item = obj.data ?? {};
  if (friends.some((f) => f.url.trim().toLowerCase() === String(item.url ?? '').trim().toLowerCase())) {
    throw conflict(`「${item.name ?? item.url}」已经在友链列表里了，不用恢复`);
  }
  const next = [...friends, { ...item, visible: item.visible !== false }];
  await writeJsonFile(LINKS_FILE(), { friends: next });
  return { ok: true, name: item.name };
}

/** 供 /api/health/data 之类做格式检查用（不写文件）*/
export async function linksFileExists() {
  try {
    await fs.access(LINKS_FILE());
    return true;
  } catch {
    return false;
  }
}
