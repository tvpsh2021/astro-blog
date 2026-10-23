export const HOME_PAGE_SIZE = 10;
export const ARCHIVE_PAGE_SIZE = 20;

export function pageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function pageItems<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize);
}

export function pagePath(basePath: string, page: number): string {
  return page === 1 ? basePath : `${basePath}page/${page}/`;
}
