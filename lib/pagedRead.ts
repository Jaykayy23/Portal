// Reading a whole filtered set out of PostgREST, rather than its first page.
//
// The Data API caps every response at `max_rows` (1000 here). A query that asks
// for more silently receives less, which is fine for a preview and wrong for a
// total: the ledger adds up what it was given and reports it as the year. So the
// reads that feed money figures page through the filter instead of asking once,
// and say so when they stop early rather than returning a short answer that
// looks complete.
//
// Keyset, not offset. Offset paging re-runs the sort for every page and shifts
// under inserts — a delivery filed between page 1 and page 2 pushes a row across
// the boundary, and that row is then either counted twice or not at all. Keyset
// carries the last row's sort position forward, so pages stay disjoint no matter
// what is written underneath.

/** The Data API's per-response ceiling. A page may not usefully be larger. */
export const READ_PAGE_SIZE = 1000;

/**
 * Where the last page stopped.
 *
 * The timestamp alone is not a position. Every line of one bulk settlement
 * carries that settlement's `settled_at` to the microsecond, and a back-dated
 * remittance stamps a whole day's worth at midnight — so ties are ordinary here,
 * not a curiosity. Paging on the timestamp alone either skips the rest of a tie
 * (exclusive) or never gets past it (inclusive); the row id breaks it, which is
 * why the reads order by `(sort, id)` and the cursor carries both.
 */
export interface ReadCursor {
  sort: string;
  id: string;
}

export interface PagedRead<T> {
  rows: T[];
  /**
   * The ceiling was reached, so these are the newest rows and not all of them.
   * Whatever is computed from them is a floor, not a total — say so on screen.
   */
  truncated: boolean;
}

/**
 * The PostgREST filter for "strictly after this position" in a descending
 * `(column, id)` sort: an older row, or the same instant with a lower id.
 *
 * Safe to interpolate. Both values come from Postgres and are a timestamp and a
 * uuid, neither of which can contain the comma or parenthesis that would end a
 * term — and neither is user input.
 */
export function keysetBefore(column: string, cursor: ReadCursor): string {
  return `${column}.lt.${cursor.sort},and(${column}.eq.${cursor.sort},id.lt.${cursor.id})`;
}

interface PageRequest<T> {
  /**
   * Runs one page. `cursor` is the position of the last row already read, or
   * null for the first page. The query must order descending on the same
   * `(column, id)` the cursor describes.
   */
  page: (
    cursor: ReadCursor | null,
    size: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  /** The row's position in that sort. */
  cursorOf: (row: T) => ReadCursor;
  /** Hard ceiling across all pages, so a runaway read cannot exhaust memory. */
  maxRows: number;
  /** Wraps a PostgREST error in the calling module's error type. */
  fail: (message: string) => Error;
  pageSize?: number;
}

/**
 * Every row matching a filter, newest first, up to `maxRows`.
 *
 * The duplicate check and the no-progress guard are backstops rather than
 * working parts: with a correct composite cursor neither should ever fire. They
 * are here because the alternative failure — a page repeating until the request
 * times out, or a row counted twice in a total — is silent, and this is the
 * money path.
 */
export async function readAllPages<T>({
  page,
  cursorOf,
  maxRows,
  fail,
  pageSize = READ_PAGE_SIZE,
}: PageRequest<T>): Promise<PagedRead<T>> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let cursor: ReadCursor | null = null;

  for (;;) {
    const { data, error } = await page(cursor, pageSize);
    if (error) throw fail(error.message);
    const batch = data ?? [];

    let fresh = 0;
    for (const row of batch) {
      const { id } = cursorOf(row);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      fresh++;
      // At the ceiling with a full page in hand there is almost certainly more
      // behind it. A set that ends exactly on the ceiling reports truncated
      // when it was in fact complete — the harmless direction to be wrong in.
      if (rows.length >= maxRows) return { rows, truncated: true };
    }

    // Short page: the filter is exhausted, and this is the whole set.
    if (batch.length < pageSize) return { rows, truncated: false };

    // A full page of rows already seen means the cursor did not move. Stop and
    // report the set as incomplete rather than asking for it again forever.
    if (fresh === 0) return { rows, truncated: true };

    cursor = cursorOf(batch[batch.length - 1]);
  }
}
