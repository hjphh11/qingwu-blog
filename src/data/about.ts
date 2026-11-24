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
  /**
   * 「设备间」：这站真正跑在什么上面。
   *
   * ⚠️ 这里刻意不写个人硬件与日常软件 —— 那些只有站长自己知道，编不得。
   *    要加就加在 about.json 里，页面按 label/value 逐条渲染，不用改模板。
   *    `default([])` 让老数据（没有这两块的提交）照样能通过校验。
   */
  uses: z
    .array(
      z.object({
        label: z.string().min(1, '不能为空'),
        value: z.string().min(1, '不能为空'),
      }),
    )
    .default([]),
  /** 站点时间线：日期 + 版本 + 一句话。与 changelog 同源，但只收里程碑 */
  timeline: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '写成 YYYY-MM-DD'),
        version: z.string().optional(),
        title: z.string().min(1, '不能为空'),
        note: z.string().min(1, '不能为空'),
      }),
    )
    .default([]),
});

const data = parseJson(schema, raw, 'src/data/about.json');

export const profile = data.profile;
export const info = data.info;
export const emis = data.emis;
export const contacts = data.contacts;
export const uses = data.uses;
export const timeline = data.timeline;
