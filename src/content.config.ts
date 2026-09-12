import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { categoryIds } from './data/categories';

// 分类**不再是写死的 tech/life**：以 src/data/categories.json 为准，
// 前台 /blog 的筛选按钮也由同一份表生成（见 components/BlogList.astro）。
// 后台新增分类 → 改 categories.json 即可，schema 与前台会自动跟着变。
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    pubDate: z.coerce.date(),
    category: z
      .string()
      .refine((v) => categoryIds.includes(v), {
        message: `未知分类，请先在 src/data/categories.json 里定义（当前可用：${categoryIds.join(' / ')}）`,
      }),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // 置顶：为 true 的文章排在其他文章前面（见 src/lib/posts.ts 的 sortPosts）
    pinned: z.boolean().default(false),
    // 置顶之间的先后顺序（后台「置顶区上下移动」写入）。数字小的在前；
    // 不填则排在有值的后面，同组内仍按发布时间倒序。只有 pinned=true 时才有意义。
    pinOrder: z.number().int().optional(),
  }),
});

export const collections = { blog };
