import type { APIRoute } from "astro";
import { ARCHIVE_PAGE_SIZE, HOME_PAGE_SIZE, pageCount } from "../lib/pagination";
import { getPosts } from "../lib/wordpress";
import { escapeXml } from "../lib/xml";

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error("Astro site URL is required to generate the sitemap.");

  const posts = await getPosts();
  const listPaths = ["/", "/archive/"];
  for (let page = 2; page <= pageCount(posts.length, HOME_PAGE_SIZE); page += 1) {
    listPaths.push(`/page/${page}/`);
  }
  for (let page = 2; page <= pageCount(posts.length, ARCHIVE_PAGE_SIZE); page += 1) {
    listPaths.push(`/archive/page/${page}/`);
  }

  const entries = [
    ...listPaths.map((path) => `  <url><loc>${escapeXml(new URL(path, site).href)}</loc></url>`),
    ...posts.map((post) => {
      const lastmod = new Date(`${post.modified}+08:00`).toISOString();
      return `  <url><loc>${escapeXml(new URL(post.path, site).href)}</loc><lastmod>${lastmod}</lastmod></url>`;
    }),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
