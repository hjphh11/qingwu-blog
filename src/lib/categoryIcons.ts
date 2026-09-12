// 分类 → 图标。categories.json 里写图标名，这里映射成实际图标节点。
// 拆成单独文件是为了让 `src/content.config.ts` 能只 import 数据、不顺带拖进图标数据。
import { Sparkles, Flower2, BookOpen, Music, Laptop } from './icons';
import { categories } from '../data/categories';

const ICON_MAP: Record<string, unknown> = {
  sparkles: Sparkles,
  flower: Flower2,
  book: BookOpen,
  music: Music,
  laptop: Laptop,
};

const DEFAULT_ICON = Sparkles;

/** 取分类图标；没写 icon 或名字认不出，都用默认图标 */
export function categoryIcon(id: string): unknown {
  const name = categories.find((c) => c.id === id)?.icon;
  return (name && ICON_MAP[name]) || DEFAULT_ICON;
}
