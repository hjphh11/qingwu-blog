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
}

const schema = z.object({
  friends: z.array(
    z.object({
      name: z.string().min(1, '不能为空'),
      avatar: urlLike,
      intro: z.string(),
      url: urlLike,
    }),
  ),
});

export const friends: Friend[] = parseJson(schema, raw, 'src/data/links.json').friends;
