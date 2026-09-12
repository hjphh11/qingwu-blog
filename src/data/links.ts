// 友链数据。
// **数据本体在 `links.json`**（后台按 JSON 增删改）；这里只做 zod 校验并 re-export，
// 所以消费方依旧 `import { friends } from '../data/links'`，与迁移前完全一致。
import { z } from 'astro/zod';
import { parseJson, urlLike } from '../lib/validate';
import raw from './links.json';

export interface Friend {
  name: string;
  avatar: string;
  intro: string;
  url: string;
  /**
   * 后台用：是否显示（方案第 34 条）—— **只影响后台列表，前台照旧全渲染**。
   * 默认视作 true。
   */
  visible?: boolean;
  /** 后台用：添加时间（后台自动记录，如 2026-09-12）。前台不展示 */
  addedAt?: string;
}

const schema = z.object({
  friends: z.array(
    z.object({
      name: z.string().min(1, '不能为空'),
      avatar: urlLike,
      intro: z.string(),
      url: urlLike,
      visible: z.boolean().default(true),
      addedAt: z.string().optional(),
    }),
  ),
});

export const friends: Friend[] = parseJson(schema, raw, 'src/data/links.json').friends;
