export const APP_POOL = Symbol('APP_POOL');
export const ADMIN_POOL = Symbol('ADMIN_POOL');
/**
 * Read-replica pool (Session 44). When no distinct DATABASE_READ_URL is
 * configured this is wired as an alias of APP_POOL (no extra connections) —
 * see DatabaseModule. Only genuinely read-only queries opt into it; the
 * default for all data access stays the primary APP_POOL (safety).
 */
export const REPLICA_POOL = Symbol('REPLICA_POOL');
