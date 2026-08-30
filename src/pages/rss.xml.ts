import { getCollection } from 'astro:content';
import { SITE } from '../config';

export async function GET() {
  const posts = (await getCollection('blog'))
    .filter((p) => !p.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  const items = posts
    .map(
      (p) => `    <item>
      <title>${p.data.title}</title>
      <link>${SITE.url}/blog/${p.id}</link>
      <guid>${SITE.url}/blog/${p.id}</guid>
      <pubDate>${p.data.pubDate.toUTCString()}</pubDate>
      <description><![CDATA[${p.data.description ?? ''}]]></description>
    </item>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${SITE.title}</title>
    <link>${SITE.url}</link>
    <description>${SITE.description}</description>
    <language>${SITE.language}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
