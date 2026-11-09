import { getCollection } from 'astro:content';
import { SITE } from '../config';

/**
 * XML 文本节点转义。
 *
 * 标题里出现 `&`、`<` 而不转义，整个 feed 会变成非法 XML ——
 * 所有抓取器直接解析失败，表现就是「抓不到 / 不更新」，而且很难查。
 */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** CDATA 段：内容里若有 `]]>` 要拆开，否则会提前闭合 */
function cdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

export async function GET() {
  const posts = (await getCollection('blog'))
    .filter((p) => !p.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  const items = posts
    .map((p) => {
      const url = `${SITE.url}/blog/${p.id}`;
      const desc = p.data.description ?? '';
      return `    <item>
      <title>${esc(p.data.title)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${p.data.pubDate.toUTCString()}</pubDate>
      <dc:creator>${esc(SITE.author)}</dc:creator>
      <description>${cdata(desc)}</description>
      <content:encoded>${cdata(`<p>${desc}</p>`)}</content:encoded>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(SITE.title)}</title>
    <link>${esc(SITE.url)}</link>
    <description>${esc(SITE.description)}</description>
    <language>${SITE.language}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>清吾 · Astro</generator>
    <ttl>60</ttl>
    <image>
      <url>${SITE.url}/images/avatar.jpg</url>
      <title>${esc(SITE.title)}</title>
      <link>${esc(SITE.url)}</link>
    </image>
    <atom:link href="${SITE.url}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
