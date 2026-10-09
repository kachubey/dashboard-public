export const PAGE_SIZE = 50;

/** ILIKE pattern for a user-typed search term, with %, _ and \ escaped. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function pageOffset(page: number): number {
  return (Math.max(1, page) - 1) * PAGE_SIZE;
}
