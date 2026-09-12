// 关于页管理（方案 §4.7）。
//
// 数据本体是 `src/data/about.json`，四块：profile / info / emis / contacts。
// 这里用**整块替换**的语义：后台把某一块整体 PUT 回来
//   · profile：对象（5 个字段）
//   · info：条目数组（图标/标签/值），可增删排序
//   · emis：对象（头像路径 + 人设段落数组）
//   · contacts：条目数组（图标/标签/动作 copy|link/值）
// 这样比"按索引改某一项"稳得多，也刚好匹配后台「改完点保存」的交互。
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { badRequest, readJsonFile, writeJsonFile } from './jsonFile.js';

const ABOUT_FILE = () => path.join(config.repoPath, 'src', 'data', 'about.json');

const urlLike = z.string().trim().min(1, '不能为空');

const ProfileSchema = z.object({
  name: z.string().trim().min(1, '名字不能为空').max(30),
  tagline: z.string().max(80, '标语最多 80 字'),
  whyName: z.string().max(300),
  whyBlog: z.string().max(600),
  whatWrite: z.string().max(300),
});

const InfoSchema = z.array(
  z.object({
    icon: z.string().trim().min(1, '图标不能为空'),
    label: z.string().trim().max(20, '标签最多 20 字'),
    value: z.string().max(120),
  }),
).max(12, '最多 12 条');

const EmisSchema = z.object({
  img: urlLike.max(300),
  persona: z.array(z.string().max(1200)).max(12, '最多 12 段'),
});

const ContactsSchema = z.array(
  z.object({
    icon: z.string().trim().min(1, '图标不能为空'),
    label: z.string().trim().max(20),
    action: z.enum(['copy', 'link']),
    value: z.string().trim().min(1, '内容不能为空').max(300),
  }),
).max(10, '最多 10 条');

const AboutSchema = z.object({
  profile: ProfileSchema,
  info: InfoSchema,
  emis: EmisSchema,
  contacts: ContactsSchema,
});

/** 可选图标名 —— 必须与前台 `src/lib/aboutIcons.ts` 的名单一致 */
export const ABOUT_ICON_NAMES = [
  'map', 'school', 'code', 'music', 'mail', 'github', 'globe', 'house',
  'building', 'book', 'heart', 'flower', 'sparkles', 'link', 'message',
  'send', 'info', 'clock', 'compass', 'wrench', 'headphones', 'image',
  'chart', 'timer',
];

/** 图标必须在名单里（前台认不出会回落成默认图标，但这里拦住更省心）*/
function assertIcons(items, field) {
  for (const it of items) {
    if (!ABOUT_ICON_NAMES.includes(it.icon)) {
      throw badRequest(`${field} 里的图标「${it.icon}」不在可选范围里`);
    }
  }
}

export async function readAbout() {
  const data = await readJsonFile(ABOUT_FILE());
  const parsed = AboutSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(
      `about.json 结构不对：${first.path.join('.') || '(根)'} —— ${first.message}`,
      'bad_about_file',
    );
  }
  return parsed.data;
}

export async function getAbout() {
  const data = await readAbout();
  return { ...data, availableIcons: ABOUT_ICON_NAMES };
}

/**
 * 部分保存：只处理传进来的那几块（没传的保持原样）。
 * 每一块整体替换 —— 增删改排序都在客户端改好整块再提交。
 */
export async function saveAbout(patch) {
  if (!patch || typeof patch !== 'object') throw badRequest('没有要保存的内容');
  const current = await readAbout();
  const next = { ...current };

  if (patch.profile !== undefined) {
    const r = ProfileSchema.safeParse(patch.profile);
    if (!r.success) {
      const f = r.error.issues[0];
      throw badRequest(`profile.${f.path.join('.') || '(根)'}：${f.message}`, 'validation');
    }
    next.profile = r.data;
  }

  if (patch.info !== undefined) {
    const r = InfoSchema.safeParse(patch.info);
    if (!r.success) {
      const f = r.error.issues[0];
      throw badRequest(`info：${f.path.join('.') || '(根)'} —— ${f.message}`, 'validation');
    }
    assertIcons(r.data, 'info');
    next.info = r.data;
  }

  if (patch.emis !== undefined) {
    const r = EmisSchema.safeParse(patch.emis);
    if (!r.success) {
      const f = r.error.issues[0];
      throw badRequest(`emis：${f.path.join('.') || '(根)'} —— ${f.message}`, 'validation');
    }
    next.emis = r.data;
  }

  if (patch.contacts !== undefined) {
    const r = ContactsSchema.safeParse(patch.contacts);
    if (!r.success) {
      const f = r.error.issues[0];
      throw badRequest(`contacts：${f.path.join('.') || '(根)'} —— ${f.message}`, 'validation');
    }
    assertIcons(r.data, 'contacts');
    next.contacts = r.data;
  }

  await writeJsonFile(ABOUT_FILE(), next);
  return getAbout();
}
