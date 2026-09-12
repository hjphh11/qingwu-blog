// 分享 / 语录管理（方案 §4.6 + 第 38 条）。
//
// 数据本体是 `src/data/share.json` 的 `shares` 数组，`link` 与 `quote` 混排。
// 第 38 条：加**标签**，前台 /share 可按标签筛选（前台那边已经接好了）。
//
// 与友链一样是**整表保存**（新增/修改/排序一次提交），只有删除单独走（要进回收站）。
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { badRequest, conflict, readJsonFile, writeJsonFile } from './jsonFile.js';
import { putToTrash } from './trash.js';

const SHARE_FILE = () => path.join(config.repoPath, 'src', 'data', 'share.json');

const urlLike = z.string().trim().min(1, '不能为空');
const TagsSchema = z.array(z.string().trim().min(1).max(20)).max(10, '最多 10 个标签').default([]);

const ItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('link'),
    // id 留空 = 新条目，保存时自动分配 link-N
    id: z.string().trim().max(60).default(''),
    title: z.string().trim().min(1, '标题不能为空').max(80, '标题最多 80 字'),
    url: urlLike.max(300, '链接太长'),
    note: z.string().max(200, '说明最多 200 字'),
    tags: TagsSchema,
  }),
  z.object({
    type: z.literal('quote'),
    // id 留空 = 新条目，保存时自动分配 q-N
    id: z.string().trim().max(60).default(''),
    text: z.string().trim().min(1, '内容不能为空').max(200, '一句最多 200 字'),
    author: z.string().max(40, '作者名太长').optional(),
    tags: TagsSchema,
  }),
]);

const ShareSchema = z.object({ shares: z.array(ItemSchema) });

export async function readShares() {
  const data = await readJsonFile(SHARE_FILE());
  const parsed = ShareSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(
      `share.json 结构不对：${first.path.join('.') || '(根)'} —— ${first.message}`,
      'bad_share_file',
    );
  }
  return parsed.data;
}

/** 生成 id：沿用现有约定 link-N / q-N（取当前最大值 +1，避免和历史 id 撞）*/
function nextId(type, items) {
  const prefix = type === 'link' ? 'link-' : 'q-';
  let max = 0;
  for (const it of items) {
    const m = String(it.id).match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export async function listShares() {
  const { shares } = await readShares();
  const tags = allTagsOf(shares);
  return {
    shares,
    count: shares.length,
    links: shares.filter((s) => s.type === 'link').length,
    quotes: shares.filter((s) => s.type === 'quote').length,
    tags,
  };
}

/** 所有用过的标签（给自动补全），按出现次数排 */
function allTagsOf(shares) {
  const count = new Map();
  for (const s of shares) for (const t of s.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()]
    .map(([name, n]) => ({ name, count: n }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

export async function allShareTags() {
  return allTagsOf((await readShares()).shares);
}

/**
 * 整表保存。id 为空的新条目自动分配；已有条目保持 id 不变
 * （id 是删除/回收站的身份，不能随便变）。
 */
export async function saveShares(input) {
  const parsed = ShareSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(`${first.path.join('.') || '(根)'}：${first.message}`, 'validation');
  }
  const before = (await readShares()).shares;
  const beforeIds = new Set(before.map((s) => s.id));

  // 新条目分配 id（按类型各自递增）；已有条目保持 id 不变
  const pool = [...before];
  const next = parsed.data.shares.map((raw) => {
    const it = { ...raw, tags: raw.tags ?? [] };
    if (it.id && beforeIds.has(it.id)) return it;
    const id = nextId(it.type, pool);
    pool.push({ ...it, id });
    return { ...it, id };
  });

  const dupIds = next.map((s) => s.id).filter((v, i, a) => a.indexOf(v) !== i);
  if (dupIds.length > 0) throw conflict(`有条目的 id 重复了：${[...new Set(dupIds)].join('、')}`);

  await writeJsonFile(SHARE_FILE(), { shares: next });
  return listShares();
}

/** 删除一条 → 回收站 */
export async function deleteShare(id) {
  const target = String(id ?? '').trim();
  if (!target) throw badRequest('需要给出要删除的条目 id');
  const { shares } = await readShares();
  const idx = shares.findIndex((s) => s.id === target);
  if (idx === -1) throw badRequest('这条分享/语录不存在');

  const item = shares[idx];
  const entry = await putToTrash({
    type: 'share',
    key: item.id,
    originalPath: `src/data/share.json#shares[${idx}]`,
    data: item,
    note: item.type === 'link' ? '删除收藏' : '删除语录',
  });
  const next = shares.filter((s) => s.id !== target);
  await writeJsonFile(SHARE_FILE(), { shares: next });
  return { ok: true, entry, id: target };
}

/** 从回收站还原（接在列表末尾）*/
export async function restoreShareFromTrash(obj) {
  const { shares } = await readShares();
  const item = obj.data ?? {};
  if (!item.id) throw badRequest('回收站条目里没有 id，无法还原');
  if (shares.some((s) => s.id === item.id)) {
    throw conflict(`id 为 ${item.id} 的条目已经存在了`);
  }
  const next = [...shares, { ...item, tags: item.tags ?? [] }];
  await writeJsonFile(SHARE_FILE(), { shares: next });
  return { ok: true, id: item.id };
}
