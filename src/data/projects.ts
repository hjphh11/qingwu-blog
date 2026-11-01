// 项目数据。
// **数据本体在 `projects.json`**，这里只做 zod 校验并 re-export —— 与 links/about 一致。
//
// 文案口径：**只用源码里能验证的事实**（2026-11-01 逐个核对过）：
//   · emis-envcheck（源码 D:\zm\hjjc）：scan.ps1 = 3055 行、release exe = 6.1MB、
//     App.tsx 的 TABS = 体检/环境/兼容/监控 四个、dev/verify.ps1 断言 compat ≥ 17 项、
//     verify.ps1 自身 540 行、README 的「绿色版承诺」。
//   · 清吾 API（源码 D:\zm\api）：pom 里 Spring Boot 3.2.5、19 个 Controller 共 131 个
//     Mapping 注解、tools/gen_api_docs.py 里 8 种语言示例、README 的 32 项冒烟测试与 909 条省市区。
// 改数字前请回去数一遍，不要凭印象。
import { z } from 'astro/zod';
import { parseJson } from '../lib/validate';
import raw from './projects.json';

export interface Project {
  slug: string;
  /** 卡片右上角的年份 */
  year: string;
  name: string;
  /** 类别小标签，如「Windows 工具」「后端服务」 */
  kind: string;
  stack: string[];
  /** 一句话说清它是干什么的 */
  summary: string;
  /** 为什么做 */
  motivation: string;
  /** 最难的一点 */
  hardest: string;
  /** 做成了什么 */
  result: string;
  /** 关键数字，卡片与 sheet 都以小标签呈现 */
  facts: string[];
  /** 没有对外地址就填 null（卡片与 sheet 都不出现外链） */
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
      year: z
        .string()
        .regex(/^\d{4}$/, '四位年份，如 "2026"')
        .default('2026'),
      name: z.string().min(1, '不能为空'),
      kind: z.string().min(1, '不能为空'),
      stack: z.array(z.string()).default([]),
      summary: z.string().min(1, '不能为空'),
      motivation: z.string().min(1, '不能为空'),
      hardest: z.string().min(1, '不能为空'),
      result: z.string().min(1, '不能为空'),
      facts: z.array(z.string()).default([]),
      link: z.string().url('需要是完整 http(s) 链接').nullable().default(null),
      placeholder: z.boolean().default(false),
    }),
  ),
});

export const projects: Project[] = parseJson(schema, raw, 'src/data/projects.json').projects;
