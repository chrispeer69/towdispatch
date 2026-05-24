/**
 * Region-aware DB connection routing (Session 44).
 *
 * Two pools exist at runtime:
 *   - APP_POOL      the primary, RLS-enforcing app_user pool. ALL writes and,
 *                   by default, all reads go here.
 *   - REPLICA_POOL  a read replica. Only genuinely read-only queries opt in,
 *                   and only when a DISTINCT DATABASE_READ_URL is configured.
 *                   Otherwise REPLICA_POOL is an alias of APP_POOL.
 *
 * `selectPoolToken` is the single decision point, kept pure so the routing
 * rule is unit-tested in isolation (connection.spec.ts). The bias is
 * deliberate: anything that isn't explicitly opt-in read-only AND backed by a
 * real replica falls through to the primary. A stale read is a bug; a write to
 * a replica is data loss.
 */
import { APP_POOL, REPLICA_POOL } from './database.tokens.js';

export interface PoolSelection {
  /** Caller asserts this unit of work issues no writes. */
  readonly: boolean;
  /** A distinct read replica is configured (ConfigService.readReplicaConfigured). */
  replicaConfigured: boolean;
}

/**
 * Returns the DI token for the pool a unit of work should use.
 * REPLICA_POOL only when BOTH the work is read-only AND a real replica exists;
 * every other combination → APP_POOL (primary).
 */
export function selectPoolToken({
  readonly,
  replicaConfigured,
}: PoolSelection): typeof APP_POOL | typeof REPLICA_POOL {
  if (readonly && replicaConfigured) return REPLICA_POOL;
  return APP_POOL;
}
