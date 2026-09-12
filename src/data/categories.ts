// 文章分类表。
// **数据本体在 `categories.json`**：后台加/改分类只动它，前台筛选与文章 schema 都跟着变。
// 这个模块**不引入图标**（图标映射在 `src/lib/categoryIcons.ts`），
// 因为 `src/content.config.ts` 也要 import 它 —— 别把 lucide 图标数据拖进构建配置里。
import { z } from 'astro/zod';
import { parseJson } from '../lib/validate';
import raw from './categories.json';

export interface Category {
  id: string;
  label: string;
  order: number;
  /** 图标名，见 src/lib/categoryIcons.ts；不填用默认图标 */
  icon?: string;
}

const schema = z.object({
  categories: z.array(
    z.object({
      id: z
        .string()
        .min(1, '不能为空')
        .regex(/^[a-z0-9-]+$/, '只允许小写字母、数字和连字符（会成为文章 frontmatter 里的 category）'),
      label: z.string().min(1, '不能为空'),
      order: z.number().int('需要是整数'),
      icon: z.string().optional(),
    }),
  ),
});

const list = parseJson(schema, raw, 'src/data/categories.json').categories;

// 重复 id 会让前台筛选与 schema 校验都出现难以排查的怪现象，这里直接拦下
const dup = list.map((c) => c.id).filter((v, i, a) => a.indexOf(v) !== i);
if (dup.length > 0) {
  throw new Error(
    `src/data/categories.json 里有重复的分类 id：${[...new Set(dup)].join('、')} —— 请改成唯一的`,
  );
}

/** 按 order 排好序（order 相同时按 id 稳定兜底） */
export const categories: Category[] = [...list].sort(
  (a, b) => a.order - b.order || a.id.localeCompare(b.id),
);

/** 供文章 schema 与「分类是否存在」判断用 */
export const categoryIds: string[] = categories.map((c) => c.id);

const byId = new Map(categories.map((c) => [c.id, c]));

/** 分类 id → 显示名；查不到就原样返回 id（不至于让页面崩） */
export function categoryLabel(id: string): string {
  return byId.get(id)?.label ?? id;
}

export function categoryExists(id: string): boolean {
  return byId.has(id);
}
