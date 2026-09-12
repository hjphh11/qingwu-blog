// 分享 / 语录数据。
// **数据本体在 `share.json`**；这里只做 zod 校验并 re-export。
import { z } from 'astro/zod';
import { parseJson, urlLike } from '../lib/validate';
import raw from './share.json';

export type ShareItem =
  | { type: 'link'; id: string; title: string; url: string; note: string; tags: string[] }
  | { type: 'quote'; id: string; text: string; author?: string; tags: string[] };

const schema = z.object({
  shares: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('link'),
        id: z.string().min(1, '不能为空'),
        title: z.string(),
        url: urlLike,
        note: z.string(),
        // 方案第 38 条：加标签，前台可按标签筛选
        tags: z.array(z.string()).default([]),
      }),
      z.object({
        type: z.literal('quote'),
        id: z.string().min(1, '不能为空'),
        text: z.string(),
        author: z.string().optional(),
        tags: z.array(z.string()).default([]),
      }),
    ]),
  ),
});

export const shares: ShareItem[] = parseJson(schema, raw, 'src/data/share.json').shares;
