const WORDPRESS_URL = import.meta.env.WP_API_BASE_URL?.trim();
if (!WORDPRESS_URL) {
  throw new Error("WP_API_BASE_URL is required. Set it in .env or the build environment.");
}
const PER_PAGE = 100;

interface Term {
  id: number;
  link: string;
  name: string;
  slug: string;
  taxonomy: string;
}

export interface PostTerm {
  id: number;
  name: string;
  /** WordPress archive path, e.g. /category/parent/child/ or /tag/slug/, kept for old links. */
  path: string;
}

export interface Category extends PostTerm {
  parent: number;
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
  categories: PostTerm[];
  tags: PostTerm[];
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

function toPostTerm(term: Pick<Term, "id" | "name" | "link">): PostTerm {
  return { id: term.id, name: decodeEntities(term.name), path: new URL(term.link).pathname };
}

function normalizePost(post: WordPressPost): Post {
  const path = new URL(post.link).pathname;
  const match = path.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\/$/);
  if (!match) throw new Error(`Unsupported permalink for post ${post.id}: ${post.link}`);

  const terms = post._embedded?.["wp:term"]?.flat() ?? [];
  const excerpt = plainText(post.excerpt.rendered)
    .replace(/\s*(?:…\s*)?閱讀全文\s*〈.*$/, "")
    // WordPress trims excerpts by length and can cut an entity in half, e.g. "&quot".
    .replace(/&#?\w*$/, "")
    // Excerpts collapse line breaks to spaces; between CJK text a space is almost always
    // a line break in the original post, so mark it instead of gluing sentences together.
    .replace(/(?<=[\p{Script=Han}，。！？、」』）])\s+(?=[\p{Script=Han}「『（])/gu, "／")
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
    categories: terms.filter((term) => term.taxonomy === "category").map(toPostTerm),
    tags: terms.filter((term) => term.taxonomy === "post_tag").map(toPostTerm),
    featuredImage: post._embedded?.["wp:featuredmedia"]?.[0],
  };
}

async function fetchApi(endpoint: string, params: Record<string, string>, page: number) {
  const url = new URL(`/wp-json/wp/v2/${endpoint}`, WORDPRESS_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("page", String(page));
  const response = await fetch(url);
  if (!response.ok) {
    const ray = response.headers.get("cf-ray");
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(
      `WordPress API ${endpoint} page ${page} failed: ${response.status} ${response.statusText}`
      + ` (origin: ${url.origin}, cf-ray: ${ray ?? "none"})${detail ? `: ${detail}` : ""}`,
    );
  }

  const totalPages = Number(response.headers.get("X-WP-TotalPages"));
  const total = Number(response.headers.get("X-WP-Total"));
  if (!Number.isInteger(totalPages) || totalPages < 1 || !Number.isInteger(total) || total < 1) {
    throw new Error(`WordPress API ${endpoint} page ${page} returned invalid pagination headers`);
  }
  return { items: (await response.json()) as unknown[], totalPages, total };
}

/** Fetches every page of an endpoint and checks the item count against X-WP-Total. */
async function fetchAll<T>(endpoint: string, params: Record<string, string>): Promise<T[]> {
  const first = await fetchApi(endpoint, params, 1);
  const pages = [first.items];
  // Sequential requests keep load on the WordPress origin predictable.
  for (let page = 2; page <= first.totalPages; page += 1) {
    pages.push((await fetchApi(endpoint, params, page)).items);
  }
  const items = pages.flat() as T[];
  if (items.length !== first.total) {
    throw new Error(`WordPress API ${endpoint} returned ${items.length} items; expected ${first.total}`);
  }
  return items;
}

let postsPromise: Promise<Post[]> | undefined;

export function getPosts(): Promise<Post[]> {
  postsPromise ??= loadPosts();
  return postsPromise;
}

async function loadPosts(): Promise<Post[]> {
  const rawPosts = await fetchAll<WordPressPost>("posts", { status: "publish", _embed: "1" });
  const posts = rawPosts.map(normalizePost);
  if (new Set(posts.map((post) => post.path)).size !== posts.length) {
    throw new Error("WordPress API returned duplicate post paths");
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

let categoriesPromise: Promise<Category[]> | undefined;

/** All categories, including empty ones; post embeds lack the parent needed for the hierarchy. */
export function getCategories(): Promise<Category[]> {
  categoriesPromise ??= fetchAll<Term & { parent: number }>("categories", { _fields: "id,link,name,parent" })
    .then((terms) => terms.map((term) => ({ ...toPostTerm(term), parent: term.parent })));
  return categoriesPromise;
}
