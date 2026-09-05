---
title: "Astro 内容集合与静态路径：一篇文章是怎么被渲染成页面的"
description: "记录我用 Astro 的 content collections + getStaticPaths 做博客列表与详情页的思路，含目录、阅读时长与草稿过滤的实现细节。"
pubDate: 2026-09-05
category: tech
tags: ["Astro", "静态站点", "Markdown"]
---

把 Markdown 变成一张张带目录、带阅读进度、带分享按钮的文章页，是 Astro 最擅长的事。这篇记录一下我踩过的跟内容集合（content collections）与 `getStaticPaths` 相关的几个点。

## 先在配置文件里声明集合

Astro 需要用配置文件告诉它文章长什么样。我在 `src/content.config.ts` 里定义 `blog` 集合，并给每一篇加一个 schema，用来做校验和类型提示：

```ts
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    pubDate: z.coerce.date(),
    category: z.enum(['tech', 'life']),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});
```

这里有两个值得一提的地方：

- 用 `glob` 自动扫描 `src/content/blog/` 下的 Markdown 文件，新增文章只需丢一个 `.md` 进去，不用改代码。
- `pubDate` 前加了 `z.coerce.date()`，允许我在 frontmatter 里写一个「字符串日期」，它会帮我转成 `Date`，省去手写 `new Date()` 的麻烦。

## 列表页怎么拿到所有文章

列表页用 `getCollection` 读取，过滤掉草稿后，再按发布时间从新到旧排序：

```ts
const posts = (await getCollection('blog'))
  .filter((p) => !p.data.draft)
  .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
```

`draft` 字段现在默认 `false`，写草稿时把它设成 `true`，文章就会从列表和详情页里消失，但文件还留在目录里，改完再发布，挺顺手的。

分类切换我放在了前端：给每张卡片挂个 `data-category`，点击按钮时用 JS 控制显示/隐藏。这样不用为每个分类单独生成页面，列表只生成一次就行。

## 详情页：用 getStaticPaths 生成所有路由

详情页是动态路由 `[slug].astro`。因为站点是纯静态输出，所以需要用 `getStaticPaths` 在构建期把每一篇文章、每一条 URL 都定下来：

```ts
export async function getStaticPaths() {
  const posts = (await getCollection('blog')).filter((p) => !p.data.draft);
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}
```

`post.id` 就是文件名（不含扩展名），比如 `hello-astro` 就会对应 `/blog/hello-astro`。

## 目录、阅读时长这些小细节

详情页里我用 `render(post)` 拿到渲染后的内容和小标题结构：

```ts
const { Content, headings } = await render(post);

const catLabel = post.data.category === 'tech' ? '技术' : '记录';
const chars = (post.body || '').replace(/\s/g, '').length;
const readMin = Math.max(1, Math.round(chars / 400));

const toc = headings.filter((h) => h.depth === 2 || h.depth === 3);
```

- **阅读时长**：把正文的空白去掉再数一遍字数，按大约每分钟 400 字估算，向上取整。粗算，但够用了。
- **目录**：`headings` 里保留 `h2` 和 `h3`，右侧用一枚 `List` 图标配一条淡玫瑰色的竖线，点一下锚点跳转。因为 `render` 会帮标题自动生成 `slug`，所以我直接用 `h.slug` 拼出 `#` 链接。

## 分享按钮在正文下面

正文底部我放了一个「分享」按钮，把它对应的绝对 URL 和标题传进去，方便复制链接或跳转邮箱。这样一篇走完 Markdown → 静态页面的文章，就完成了它的使命——被写出来，也被分享出去。

## 小结

这套流程真正的价值是：**写作和构建解耦**。我只管往 `src/content/blog/` 里丢 Markdown，其它的一切——路由、目录、时长、草稿过滤——都交给 Astro 的内容集合去处理。这也是我当初选它的原因之一。
