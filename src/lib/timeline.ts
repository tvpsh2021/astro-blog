import { ARCHIVE_PAGE_SIZE, pagePath } from "./pagination";
import type { Post } from "./wordpress";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export interface YearGroup {
  year: string;
  posts: Post[];
}

export interface YearActivity {
  year: number;
  total: number;
  monthCounts: number[];
  /** Archive page holding the year's newest post; undefined for years without posts. */
  href?: string;
}

/** Posts must already be sorted newest first. */
export function groupByYear(posts: Post[]): YearGroup[] {
  const groups: YearGroup[] = [];
  for (const post of posts) {
    const last = groups.at(-1);
    if (last?.year === post.year) last.posts.push(post);
    else groups.push({ year: post.year, posts: [post] });
  }
  return groups;
}

/** Archive URL of the page holding the post at `index` (newest-first order), anchored at its year. */
export function archiveYearHref(index: number, year: string | number): string {
  const page = Math.floor(index / ARCHIVE_PAGE_SIZE) + 1;
  return `${pagePath("/archive/", page)}#y${year}`;
}

/** Every year from the oldest to the newest post, including years without posts. */
export function yearlyActivity(posts: Post[]): YearActivity[] {
  if (posts.length === 0) return [];
  const byYear = new Map<number, YearActivity>();
  posts.forEach((post, index) => {
    const year = Number(post.year);
    let entry = byYear.get(year);
    if (!entry) {
      entry = { year, total: 0, monthCounts: Array(12).fill(0), href: archiveYearHref(index, year) };
      byYear.set(year, entry);
    }
    entry.total += 1;
    entry.monthCounts[Number(post.month) - 1] += 1;
  });
  const years = [...byYear.keys()];
  const first = Math.min(...years);
  const last = Math.max(...years);
  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const year = first + offset;
    return byYear.get(year) ?? { year, total: 0, monthCounts: Array(12).fill(0) };
  });
}

export function activityLevel(count: number): number {
  if (count >= 5) return 4;
  if (count >= 3) return 3;
  return count;
}

export function monthDay(post: Post): string {
  return `${Number(post.month)} 月 ${Number(post.day)} 日`;
}

export function fullDate(post: Post): string {
  const weekday = new Date(Date.UTC(Number(post.year), Number(post.month) - 1, Number(post.day))).getUTCDay();
  return `${post.year} 年 ${monthDay(post)} 星期${WEEKDAYS[weekday]}`;
}
