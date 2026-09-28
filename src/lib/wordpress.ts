const WORDPRESS_URL = import.meta.env.WP_API_BASE_URL?.trim();
if (!WORDPRESS_URL) {
  throw new Error("WP_API_BASE_URL is required. Set it in .env or the build environment.");
}
const POSTS_PER_PAGE = 100;

interface Term {
  id: number;
  name: string;
  slug: string;
  taxonomy: string;
}

interface Media {
  source_url: string;
  alt_text?: string;
}

interface WordPressPost {
  id: number;
  status: string;
  link: string;
  date: string;
  modified: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string };
  _embedded?: { "wp:term"?: Term[][]; "wp:featuredmedia"?: Media[] };
}

export interface Post {
  id: number;
  path: string;
  year: string;
  month: string;
  day: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  modified: string;
  categories: Term[];
  tags: Term[];
  featuredImage?: Media;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", hellip: "…", ldquo: "“", lsquo: "‘",
    nbsp: " ", quot: '"', rdquo: "”", rsquo: "’",
  };
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith("#")) {
      const hex = key[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    return named[key.toLowerCase()] ?? entity;
  });
}

function plainText(html: string): string {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function normalizePost(post: WordPressPost): Post {
  const path = new URL(post.link).pathname;
  const match = path.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\/$/);
  if (!match) throw new Error(`Unsupported permalink for post ${post.id}: ${post.link}`);

  const terms = post._embedded?.["wp:term"]?.flat() ?? [];
  const excerpt = plainText(post.excerpt.rendered)
    .replace(/\s*(?:…\s*)?閱讀全文\s*〈.*$/, "")
    .trim();
  return {
    id: post.id,
    path,
    year: match[1], month: match[2], day: match[3],
    slug: decodeURIComponent(match[4]),
    title: plainText(post.title.rendered),
    excerpt,
    content: post.content.rendered,
    date: post.date,
    modified: post.modified,
    categories: terms.filter((term) => term.taxonomy === "category"),
    tags: terms.filter((term) => term.taxonomy === "post_tag"),
    featuredImage: post._embedded?.["wp:featuredmedia"]?.[0],
  };
}

async function fetchPage(page: number) {
  const url = new URL("/wp-json/wp/v2/posts", WORDPRESS_URL);
  url.searchParams.set("status", "publish");
  url.searchParams.set("per_page", String(POSTS_PER_PAGE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("_embed", "1");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`WordPress API page ${page} failed: ${response.status} ${response.statusText}`);

  const totalPages = Number(response.headers.get("X-WP-TotalPages"));
  const total = Number(response.headers.get("X-WP-Total"));
  if (!Number.isInteger(totalPages) || totalPages < 1 || !Number.isInteger(total) || total < 1) {
    throw new Error(`WordPress API page ${page} returned invalid pagination headers`);
  }
  const posts = (await response.json()) as WordPressPost[];
  return { posts, totalPages, total };
}

let postsPromise: Promise<Post[]> | undefined;

export function getPosts(): Promise<Post[]> {
  postsPromise ??= loadPosts();
  return postsPromise;
}

async function loadPosts(): Promise<Post[]> {
  const first = await fetchPage(1);
  const pages = [first.posts];
  // Sequential requests keep load on the WordPress origin predictable.
  for (let page = 2; page <= first.totalPages; page += 1) {
    pages.push((await fetchPage(page)).posts);
  }
  const rawPosts = pages.flat();
  if (rawPosts.length !== first.total) {
    throw new Error(`WordPress API returned ${rawPosts.length} posts; expected ${first.total}`);
  }
  const posts = rawPosts.map(normalizePost);
  if (new Set(posts.map((post) => post.path)).size !== posts.length) {
    throw new Error("WordPress API returned duplicate post paths");
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}
