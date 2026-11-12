// 画市的图片索引（**服务端 / 构建期**入口）。
//
// 数据分两处：
//   · 图片本体在 Cloudflare R2，公共域 https://img.qingwu.ink/gallery/<id>.webp
//     （瓦片是 <id>-t.webp）。一万多张，不进仓库。
//   · 索引是**站点同源**的：public/gallery/data/<n>.json 每片 500 条，
//     由 scripts/build-gallery-index.py 生成；墙每次随机取一片再挑 64 张。
//     ⚠️ 索引不能放 R2：公共域不回 Access-Control-Allow-Origin，fetch 会被浏览器拦。
//
// 本文件里的 `sample` 是构建期定下来的一小批（60 条）：SSR 那份无障碍/无 JS 清单
// 用它，前端取不到分片时也拿它兜底 —— 于是「索引挂了」只会少点花样，不会白屏。
//
// ⚠️ **别在客户端组件里 import 这个文件**：它带着 zod，打进去会把 chunk 撑大三倍
//   （实测 33KB → 91KB）。浏览器要用的常量在 gallery-meta.ts，那边没有 zod。
import { z } from 'astro/zod';
import { parseJson, urlLike } from '../lib/validate';
import { galleryJson, type GalleryItem } from './gallery-meta';

const item = z.object({
  id: z.string().regex(/^[a-f0-9]{10}$/, '是图床上的 10 位 hash'),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

const schema = z.object({
  base: urlLike,
  count: z.number().int().positive(),
  shards: z.number().int().positive(),
  perShard: z.number().int().positive(),
  sample: z.array(item).min(1),
});

const data = parseJson(schema, galleryJson, 'src/data/gallery.json');

/** 图片公共前缀，不带结尾斜杠 */
export const galleryBase: string = data.base;
/** 一共多少张（展示用） */
export const galleryCount: number = data.count;
/** 分片数 —— 前端随机取 0 … shards-1 */
export const galleryShards: number = data.shards;
/** 构建期样本：SSR 清单 + 前端兜底 */
export const gallerySample: GalleryItem[] = data.sample;

export type { GalleryItem };
export { gallerySource } from './gallery-meta';
