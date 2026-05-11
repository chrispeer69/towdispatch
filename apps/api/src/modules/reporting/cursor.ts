/**
 * Tiny opaque cursor helper. We encode the row offset in the cursor; the
 * cursor stays opaque to clients so we can swap it for a `(bucket, refId)`
 * shape later without breaking the API contract.
 */
export function encodeOffset(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

export function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [tag, offsetStr] = raw.split(':');
    if (tag !== 'o') return 0;
    const n = Number(offsetStr);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}
