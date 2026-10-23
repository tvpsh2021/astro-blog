import { getCategories, getPosts, type Post } from "./wordpress";

/** Tags with fewer posts get a page for in-article links but stay out of search and the index. */
export const MIN_INDEXED_TAG_POSTS = 2;

export interface TermArchive {
  name: string;
  path: string;
  /** Newest first. A category includes posts filed under its subcategories. */
  posts: Post[];
  parent?: TermArchive;
  children: TermArchive[];
}

/** Astro route param for a WordPress archive path: "/category/a/b/" -> "a/b". */
export function termParam(path: string, base: "category" | "tag"): string {
  return decodeURIComponent(path.slice(`/${base}/`.length).replace(/\/$/, ""));
}

/** Categories that hold at least one post, parents before their children. */
export async function getCategoryArchives(): Promise<TermArchive[]> {
  const [posts, categories] = await Promise.all([getPosts(), getCategories()]);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const postsById = new Map<number, Set<Post>>();
  for (const post of posts) {
    for (const category of post.categories) {
      // Credit the post to the category and every ancestor.
      for (let id: number | undefined = category.id; id; id = byId.get(id)?.parent) {
        if (!postsById.has(id)) postsById.set(id, new Set());
        postsById.get(id)!.add(post);
      }
    }
  }

  const archives = new Map<number, TermArchive>();
  for (const category of categories) {
    const categoryPosts = postsById.get(category.id);
    if (!categoryPosts) continue;
    archives.set(category.id, {
      name: category.name,
      path: category.path,
      posts: posts.filter((post) => categoryPosts.has(post)),
      children: [],
    });
  }
  for (const [id, archive] of archives) {
    const parent = archives.get(byId.get(id)!.parent);
    if (!parent) continue;
    archive.parent = parent;
    parent.children.push(archive);
  }
  const bySize = (a: TermArchive, b: TermArchive) => b.posts.length - a.posts.length;
  const flatten = (archive: TermArchive): TermArchive[] => [archive, ...archive.children.sort(bySize).flatMap(flatten)];
  return [...archives.values()].filter((archive) => !archive.parent).sort(bySize).flatMap(flatten);
}

/** Tags that hold at least one post, most used first. */
export async function getTagArchives(): Promise<TermArchive[]> {
  const posts = await getPosts();
  const archives = new Map<number, TermArchive>();
  for (const post of posts) {
    for (const tag of post.tags) {
      if (!archives.has(tag.id)) archives.set(tag.id, { name: tag.name, path: tag.path, posts: [], children: [] });
      archives.get(tag.id)!.posts.push(post);
    }
  }
  return [...archives.values()].sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name));
}
