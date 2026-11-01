// 项目数据。
// **数据本体在 `projects.json`**，这里只做 zod 校验并 re-export —— 与 links/about 一致。
//
// ⚠️ 文案是**占位**。v6 §9.3 明确写着「文案待用户补，补齐前用占位、不编造」：
//   · emis-envcheck —— 动机与难点待补
//   · boot.qingwu.ink —— 模块与规模待补
// 补齐时只改这个 JSON，页面结构不用动。
import { z } from 'astro/zod';
import { parseJson } from '../lib/validate';
import raw from './projects.json';

export interface Project {
  slug: string;
  name: string;
  /** 右上角的小标签，如「环境检测」「自建 API」 */
  kind: string;
  stack: string[];
  summary: string;
  motivation: string;
  hardest: string;
  /** 没有对外地址就填 null（卡片上不出现「打开」按钮） */
  link: string | null;
  /** 文案仍是占位 —— 页面据此显一条提示，别让占位文字被当成正式文案发出去 */
  placeholder?: boolean;
}

const schema = z.object({
  projects: z.array(
    z.object({
      slug: z
        .string()
        .min(1, '不能为空')
        .regex(/^[a-z0-9-]+$/, '只能用小写字母、数字与连字符'),
      name: z.string().min(1, '不能为空'),
      kind: z.string().min(1, '不能为空'),
      stack: z.array(z.string()).default([]),
      summary: z.string().min(1, '不能为空'),
      motivation: z.string().min(1, '不能为空'),
      hardest: z.string().min(1, '不能为空'),
      link: z.string().url('需要是完整 http(s) 链接').nullable().default(null),
      placeholder: z.boolean().default(false),
    }),
  ),
});

export const projects: Project[] = parseJson(schema, raw, 'src/data/projects.json').projects;
