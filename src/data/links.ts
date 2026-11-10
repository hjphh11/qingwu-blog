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
   * 是否显示。后台那个「展示中 / 隐藏中」开关写的就是它；
   * 前台 `links/index.astro` 会真的过滤掉 `visible === false` 的条目。
   * 默认视作 true。
   */
  visible?: boolean;
  /**
   * 推荐位：前台那张卡描金边并挂「推荐」小标。
   * 与 visible 正交 —— 推荐但隐藏是合法的（先备着，等对方把回链补上再展示）。
   */
  recommend?: boolean;
  /** 后台用：添加时间（后台自动记录，如 2026-09-12）。前台不展示 */
  addedAt?: string;
  /**
   * 站点截图（可选）。留空时前台会自动去 mShots 抓一张。
   * 值可以是绝对 URL，也可以是站内路径（/images/links/xxx.png）。
   */
  shot?: string;
}

const schema = z.object({
  friends: z.array(
    z.object({
      name: z.string().min(1, '不能为空'),
      avatar: urlLike,
      intro: z.string(),
      url: urlLike,
      visible: z.boolean().default(true),
      recommend: z.boolean().default(false),
      addedAt: z.string().optional(),
      // 选填：不写这个键就是 undefined；写了就必须是合法链接（不允许空字符串）
      shot: urlLike.optional(),
    }),
  ),
});

export const friends: Friend[] = parseJson(schema, raw, 'src/data/links.json').friends;
