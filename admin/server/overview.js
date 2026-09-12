// 数据总览：把「文章统计 + 数据文件健康 + 仓库信息」拼起来。
// 单独一个文件，是为了避免 data.js 与 articles.js 互相 import 形成环。
import { config } from './config.js';
import { changedCount, listArticles } from './articles.js';
import { dataHealth, readData } from './data.js';

export async function overview() {
  const [health, articles, cats, changes] = await Promise.all([
    dataHealth(),
    listArticles(),
    readData('categories.json').catch(() => ({ categories: [] })),
    changedCount(),
  ]);

  const arts = articles ?? [];
  const labelOf = Object.fromEntries(cats.categories.map((c) => [c.id, c.label]));

  const byCategory = {};
  for (const a of arts) {
    if (!a.category) continue;
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
  }

  return {
    repo: {
      path: config.repoPath,
      articlesDir: `${config.repoPath}/src/content/blog`,
      articlesOk: !arts.some((a) => a.error),
      articlesError: arts.some((a) => a.error) ? '有文章的 frontmatter 解析失败' : null,
    },
    articles: {
      total: arts.length,
      published: arts.filter((a) => !a.draft).length,
      drafts: arts.filter((a) => a.draft).length,
      pinned: arts.filter((a) => a.pinned).length,
      broken: arts.filter((a) => a.error).length,
      totalChars: arts.reduce((n, a) => n + (a.chars ?? 0), 0),
      byCategory: Object.entries(byCategory).map(([id, n]) => ({
        id,
        label: labelOf[id] ?? id,
        count: n,
      })),
      recent: [...arts]
        .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)))
        .slice(0, 8)
        .map((a) => ({
          id: a.id,
          title: a.title,
          category: a.category,
          categoryLabel: labelOf[a.category] ?? a.category,
          pubDate: a.pubDate,
          draft: a.draft,
          pinned: a.pinned,
          mtime: a.mtime,
        })),
    },
    data: health,
    categories: cats.categories,
    /** 已保存到仓库、但还没提交（发布）的文件数 */
    unpublishedChanges: changes,
  };
}
