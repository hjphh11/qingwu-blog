// 更新日志数据。
// 数据本体在 `changelog.json`，这里只做 zod 校验并 re-export —— 与 projects / about / links 一致。
//
// 口径：**只写真实发生过的事**，日期以 git 提交为准（见 `git log --date=short`）。
// 数字（字体体积、LCP、仓库瘦身、篇数）都来自当次验收或提交记录，不要凭印象加一位。
import { z } from 'astro/zod';
import { parseJson } from '../lib/validate';
import raw from './changelog.json';

export interface ChangelogGroup {
  /** 分组小标签，如「阅读」「性能」 */
  label: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  summary: string;
  groups: ChangelogGroup[];
  /** 最新一版 —— 页面上给它一个「最新」徽章，并且是全站唯一的那个 */
  latest?: boolean;
}

const schema = z.object({
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '写成 YYYY-MM-DD'),
  entries: z
    .array(
      z.object({
        version: z
          .string()
          .regex(/^v\d+\.\d+$/, '版本号写成 v1.0 这种形式'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '写成 YYYY-MM-DD'),
        title: z.string().min(1, '不能为空'),
        summary: z.string().min(1, '不能为空'),
        groups: z
          .array(
            z.object({
              label: z.string().min(1, '不能为空'),
              items: z.array(z.string().min(1, '不能为空')).min(1, '每组至少一条'),
            }),
          )
          .min(1, '至少一个分组'),
        latest: z.boolean().default(false),
      }),
    )
    // 页面上就是按数组顺序渲染的，这里把「倒序」钉死，免得以后插错位置
    .min(1, '至少一版')
    .refine(
      (arr) => arr.every((e, i) => i === 0 || arr[i - 1].date >= e.date),
      '必须按日期从新到旧排列',
    )
    .refine((arr) => arr.filter((e) => e.latest).length === 1, '「最新」只能有一个'),
});

const parsed = parseJson(schema, raw, 'src/data/changelog.json');

export const changelogUpdated: string = parsed.updated;
export const changelog: ChangelogEntry[] = parsed.entries;

/** 2026-11-01 → 2026 年 11 月 1 日（不走 Intl，避免构建机时区/语言包差异） */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}
