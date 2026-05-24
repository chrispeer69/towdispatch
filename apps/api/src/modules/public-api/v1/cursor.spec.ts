import { describe, expect, it } from 'vitest';
import { buildCursorPage, decodeCursor, encodeCursor } from './cursor.js';

const UUID_A = '018f3a1c-0000-7000-8000-000000000001';
const UUID_B = '018f3a1c-0000-7000-8000-000000000002';

describe('cursor', () => {
  it('encode/decode round-trips a uuid', () => {
    const c = encodeCursor(UUID_A);
    expect(c).not.toContain(UUID_A); // opaque
    expect(decodeCursor(c)).toBe(UUID_A);
  });

  it('decodeCursor rejects absent / malformed / non-uuid cursors', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(Buffer.from('not-a-uuid', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor("'; DROP TABLE jobs;--")).toBeNull();
  });

  it('buildCursorPage trims the probe row and emits nextCursor when more exist', () => {
    const rows = [{ id: UUID_A }, { id: UUID_B }];
    // limit 1, fetched 2 (limit+1) → hasMore, nextCursor points at the kept row.
    const page = buildCursorPage(rows, 1, (r) => r.id);
    expect(page.data).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(encodeCursor(UUID_A));
  });

  it('buildCursorPage reports no more when the page is not full', () => {
    const page = buildCursorPage([{ id: UUID_A }], 25, (r) => r.id);
    expect(page.data).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('buildCursorPage handles an empty result', () => {
    const page = buildCursorPage([] as Array<{ id: string }>, 25, (r) => r.id);
    expect(page.data).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});
