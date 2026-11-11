// 画市（/gallery）的图片清单。
// **数据本体在 `gallery.json`**，由 `scripts/fetch-gallery.py` 生成 —— 别手改，
// 那个脚本同时负责下载与转码（瓦片 `<id>-t.webp`、看大图 `<id>.webp`）。
//
// 为什么不构建期扫目录：扫目录意味着「删了图但清单没更新」会在线上变成 404，
// 而且瓦片和原图两份文件靠命名约定配对，扫出来还得猜。清单是唯一事实来源。
import { z } from 'astro/zod';
import { parseJson, urlLike } from '../lib/validate';
import raw from './gallery.json';

export interface GalleryItem {
  id: string;
  /** 大图的尺寸（px）—— 灯箱按它算比例，避免加载瞬间跳一下 */
  w: number;
  h: number;
}

const schema = z.object({
  source: urlLike,
  items: z
    .array(
      z.object({
        id: z.string().regex(/^[a-f0-9]{10}$/, '是图床上的 10 位 hash'),
        w: z.number().int().positive(),
        h: z.number().int().positive(),
      }),
    )
    .min(1, '至少要有一张图'),
});

const data = parseJson(schema, raw, 'src/data/gallery.json');

export const galleryItems: GalleryItem[] = data.items;

/** 图片出处（页面上那行小字指回这里） */
export const gallerySource: string = data.source;
