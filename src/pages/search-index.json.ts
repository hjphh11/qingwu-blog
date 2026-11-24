// 清吾 · 站内搜索的静态索引（构建期生成，运行时只是一次静态 JSON 请求）
//
// 为什么不用 Pagefind：它要额外跑一遍索引器、产出几十个分片文件，还得配一次
// postbuild；这个站只有二十来篇文章，一个 JSON 就够，前端匹配是毫秒级的。
// 为什么不用 Fuse.js：多一个运行时依赖（~12KB gzip）换来的模糊匹配，对中文
// 几乎不起作用 —— 中文没有空格分词，Fuse 的位序打分反而不如直接子串命中准。
//
// 结构（字段名保持短，但要能读懂）：
//   { url, title, description, tags, category, date, text }
// text 是去掉 markdown 标记后的纯文本，用来做命中与摘要，**不参与渲染**。
//
// ⚠️ 这里是 `prerender = true` 的静态端点：产物在 /search-index.json。
//    索引会跟着文章一起变，不需要在客户端请求任何接口，也不碰数据库。
import type { APIRoute } from 'astro';
import { getPublishedPosts } from '../lib/posts';
import { categoryLabel } from '../data/categories';

export const prerender = true;

/**
 * 把 markdown 变成「可搜索的纯文本」。
 *
 * 取舍：
 *   · 代码块**保留内容**、只去掉围栏。搜 `fail2ban` / `AS to` 这类词，
 *     命中的往往就在代码里；整段丢掉等于把这些词从索引里删了。
 *   · 图片留 alt（图片说明有时就是关键词），链接留文字、丢掉 URL。
 *   · HTML 块（<div> / <img>）整个去掉标签，只留文字。
 *   · 标题里的 `##`、列表的 `-`、引用 `>` 都清掉 —— 它们会在摘要里变成噪音。
 */
function toPlainText(md: string): string {
  return md
    // 围栏本身不参与搜索，但里面的代码要留下
    .replace(/^\s*```[^\n]*$/gm, ' ')
    .replace(/`{1,3}([^`]*?)`{1,3}/g, '$1')
    // 图片 → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 链接 → 文字
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // HTML 标签
    .replace(/<[^>]+>/g, ' ')
    // 行首的标题 / 列表 / 引用 / 表格分隔
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, ' ')
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ')
    // 强调符号与剩余的反引号
    .replace(/[*_~`]/g, '')
    // 连续的空白压成一个空格（换行在摘要里没有意义）
    .replace(/\s+/g, ' ')
    .trim();
}

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();

  const index = posts.map((post) => ({
    url: `/blog/${post.id}`,
    title: post.data.title,
    description: post.data.description ?? '',
    tags: post.data.tags,
    category: categoryLabel(post.data.category),
    date: post.data.pubDate.toISOString().slice(0, 10),
    text: toPlainText(post.body ?? ''),
  }));

  return new Response(JSON.stringify(index), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 构建期就固定了；但换了文章要换文件名才能强刷，这点用 no-cache + ETag 更稳：
      // 文件本身不大（二十来篇），304 的成本远低于「搜不到刚发的文章」。
      'cache-control': 'public, max-age=0, must-revalidate',
    },
  });
};
