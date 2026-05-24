/**
 * Pool-selection logic — unit coverage. The rule is the safety boundary for
 * read/write routing: replica only when BOTH read-only AND a real replica
 * exists; everything else falls through to the primary.
 */
import { describe, expect, it } from 'vitest';
import { selectPoolToken } from './connection.js';
import { APP_POOL, REPLICA_POOL } from './database.tokens.js';

describe('selectPoolToken', () => {
  it('routes read-only work to the replica when one is configured', () => {
    expect(selectPoolToken({ readonly: true, replicaConfigured: true })).toBe(REPLICA_POOL);
  });

  it('keeps read-only work on the primary when NO distinct replica exists', () => {
    expect(selectPoolToken({ readonly: true, replicaConfigured: false })).toBe(APP_POOL);
  });

  it('always keeps writes on the primary, replica configured or not', () => {
    expect(selectPoolToken({ readonly: false, replicaConfigured: true })).toBe(APP_POOL);
    expect(selectPoolToken({ readonly: false, replicaConfigured: false })).toBe(APP_POOL);
  });
});
