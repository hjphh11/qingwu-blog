// 画市索引的**客户端入口**。
//
// ⚠️ 这个文件里**绝对不能 import zod**。
//
// 为什么单独拆一份：gallery.ts 要用 zod 校验 JSON（构建期兜底，字段写错就构建失败），
// 但那个文件同时被客户端组件 GalleryWall 引用 —— 早期版本就是这样，结果 zod 的
// 全部实现被 Rollup 一起打进了 GalleryWall 的 chunk：
//   raw 90.7KB / gzip 26.6KB，其中 zod 占 ~57KB（约 12KB gzip），组件本身只有 ~33KB。
// 校验是**构建期**的事，浏览器不需要它 —— 所以客户端走这里（纯 import + `as` 断言，
// 零运行时开销），SSR 与构建校验仍然走 gallery.ts。
//
// 两边读的是同一份 gallery.json，字段名以 `GalleryRaw` 为准；改了 JSON 结构要同步改这里。
import raw from './gallery.json';

export interface GalleryItem {
  id: string;
  /** 原图尺寸（px）—— 灯箱按它算比例，避免加载瞬间跳一下 */
  w: number;
  h: number;
}

/** src/data/gallery.json 的形状（由 scripts/build-gallery-index.py 生成） */
export interface GalleryRaw {
  /** 图片公共前缀，不带结尾斜杠 */
  base: string;
  /** 一共多少张（展示用） */
  count: number;
  /** 分片数 —— 前端随机取 0 … shards-1 */
  shards: number;
  /** 每片多少条（切片规则，前端用不到，留着给脚本/文档对齐） */
  perShard: number;
  /** 构建期样本：SSR 清单 + 前端兜底 */
  sample: GalleryItem[];
}

/** `as` 只给编辑器提示，不做校验 —— 校验在 gallery.ts，跟着构建一起跑，写错就构建失败 */
export const galleryJson = raw as GalleryRaw;

/** 图片出处（页面上那行小字指回这里） */
export const gallerySource = 'https://blog.mibase.top/photo';
