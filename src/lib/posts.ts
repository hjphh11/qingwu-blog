// 文章集合的读取与排序 —— 首页/列表/分页三处共用，避免各写一份排序逻辑。
import { getCollection } from 'astro:content';

/** 文章列表每页条数 */
export const PAGE_SIZE = 6;
/** 首页「最近文章」展示条数 */
export const HOME_RECENT = 5;

type PostLike = { data: { pinned?: boolean; pubDate: Date } };

/**
 * 置顶的排前面，其余按发布时间倒序。
 * 没有任何置顶时（当前 10 篇文章都是 pinned:false），结果与旧逻辑**完全一致**。
 */
export function sortPosts<T extends PostLike>(posts: T[]): T[] {
  return [...posts].sort((a, b) => {
    const ap = a.data.pinned ? 1 : 0;
    const bp = b.data.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
  });
}

/** 已发布（非草稿）的文章，已按「置顶优先 + 时间倒序」排好 */
export async function getPublishedPosts() {
  const posts = await getCollection('blog');
  return sortPosts(posts.filter((p) => !p.data.draft));
}
