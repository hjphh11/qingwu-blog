// 关于页数据。
// **数据本体在 `about.json`**；这里只做 zod 校验并 re-export。
import { z } from 'astro/zod';
import { parseJson, urlLike } from '../lib/validate';
import raw from './about.json';

const schema = z.object({
  profile: z.object({
    name: z.string().min(1, '不能为空'),
    tagline: z.string(),
    whyName: z.string(),
    whyBlog: z.string(),
    whatWrite: z.string(),
  }),
  info: z.array(
    z.object({
      icon: z.string().min(1, '不能为空'),
      label: z.string(),
      value: z.string(),
    }),
  ),
  emis: z.object({
    img: urlLike,
    persona: z.array(z.string()),
  }),
  // 目前前台未渲染 contacts（留给后台「关于页管理」用），但方案要求保留在 JSON 里
  contacts: z.array(
    z.object({
      icon: z.string().min(1, '不能为空'),
      label: z.string(),
      action: z.enum(['copy', 'link']),
      value: z.string(),
    }),
  ),
});

const data = parseJson(schema, raw, 'src/data/about.json');

export const profile = data.profile;
export const info = data.info;
export const emis = data.emis;
export const contacts = data.contacts;
