/**
 * Opaque keyset cursor for /v1 list endpoints (Session 29). Pure, unit-tested.
 *
 * Rows are UUIDv7-keyed, which is time-sortable, so we paginate by id DESC
 * (newest first) and the cursor is just the last row's id. Encoding is
 * base64url so the token is URL-safe and visibly opaque; decoding rejects
 * anything that isn't a well-formed uuid so a tampered cursor can't smuggle
 * SQL or widen the result set.
 */
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

/** Decode a cursor to a uuid, or null if absent/malformed. */
export function decodeCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  return UUID_RX.test(decoded) ? decoded : null;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Given `limit+1` rows fetched (the extra row probes for a next page),
 * trim to `limit` and compute the page envelope. `idOf` extracts the keyset
 * column from a row.
 */
export function buildCursorPage<T>(
  rows: T[],
  limit: number,
  idOf: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.length > 0 ? data[data.length - 1] : undefined;
  return {
    data,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(idOf(last)) : null,
  };
}
