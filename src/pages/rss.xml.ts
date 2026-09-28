import type { APIRoute } from "astro";
import { getPosts } from "../lib/wordpress";
import { escapeXml } from "../lib/xml";

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error("Astro site URL is required to generate the RSS feed.");

  const posts = await getPosts();
  const items = posts.map((post) => {
    const url = escapeXml(new URL(post.path, site).href);
    const publicationDate = new Date(`${post.date}+08:00`).toUTCString();
    return `  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${url}</link>
    <guid isPermaLink="true">${url}</guid>
    <pubDate>${publicationDate}</pubDate>
    <description>${escapeXml(post.excerpt || post.title)}</description>
  </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>淺草先生</title>
  <link>${escapeXml(site.href)}</link>
  <description>忙碌人生</description>
  <language>zh-TW</language>
${items.join("\n")}
</channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
