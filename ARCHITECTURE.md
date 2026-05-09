# TowCommand Pro — Architecture

This document records the architectural decisions made in the foundational scaffold and the reasoning behind them. Read this before adding to the codebase. **Treat the invariants as law.**

---

## 1. North Star

TowCommand Pro is a multi-tenant SaaS designed to serve **10,000+ towing companies** and process **100M+ dispatched jobs per year**. Every decision in this codebase is made with that scale in mind. We optimize for:

1. **Tenant isolation** — a bug must never expose one customer's data to another.
2. **Auditability** — every write is reconstructable, forever.
3. **Operational legibility** — structured logs, trace IDs, observable external calls.
4. **Boring, defensible technology** — Postgres, Redis, Node, TypeScript. No "novel" choices.

---

## 2. Tech stack — what and why

| Layer       | Choice                              | Rationale                                                                                                                                              |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repo        | pnpm workspaces monorepo            | Fast installs, content-addressable store, native workspace protocol. No need for Turbo/Nx complexity until we have 5+ apps.                            |
| Runtime     | Node.js 20+ (LTS)                   | Mature, well-supported, great ecosystem. Fastify benefits from undici/native fetch in 20+.                                                             |
| Language    | TypeScript 5+, strict mode          | Type safety is a core invariant. `noImplicitAny`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` are all on.                                 |
| API         | NestJS with Fastify adapter         | NestJS gives DI, modules, guards, interceptors — all of which we need for tenant context, audit, and RBAC. Fastify is ~2× faster than Express and supports schema-driven serialization.|
| Database    | PostgreSQL 16 + PostGIS             | Geospatial is core (driver positions, service zones). PostGIS is the only mature geospatial layer for relational DBs.                                  |
| ORM         | Drizzle ORM                         | Thin, SQL-first, no runtime overhead. Crucially, it lets us drop to raw SQL where we must — RLS policies, FORCE RLS, trigger functions cannot be expressed in any TypeScript schema DSL today. We avoided Prisma because its migration model fights raw SQL and its query engine adds latency. |
| Cache/Queue | Redis 7 + BullMQ                    | BullMQ is the modern Bull, supports flow-control, repeatable jobs, prioritization. Redis 7 has the streams + functions we want for future event sourcing. |
| Web         | Next.js 15 App Router               | RSC by default, route handlers, native streaming. App Router is now stable.                                                                            |
| Real-time   | Socket.IO + Redis adapter           | Socket.IO is the only library with a battle-tested fallback model and horizontal scale-out via Redis pub/sub. We will need this for live dispatch.     |
| Auth        | Custom JWT + refresh tokens         | Auth0/Clerk add per-MAU cost that breaks unit economics at our target scale. argon2id for hashing (PHC winner). Refresh tokens are stored hashed in `sessions`, rotated on use, revocable. |
| IDs         | UUIDv7                              | Sortable (insertion locality on indexed inserts) and globally unique. We never want auto-increment integers — they leak counts and break sharding.    |
| Validation  | Zod                                 | Single source of truth. Schema in `packages/shared` is consumed by both API (NestJS pipe) and Web (forms).                                             |
| Logging     | Pino                                | Fastest structured JSON logger in Node. Pretty-prints in dev, raw JSON in prod for log aggregation.                                                    |
| Errors      | Sentry                              | DSN is placeholder — wired via `SENTRY_DSN` env var.                                                                                                   |
| Testing     | Vitest + Playwright                 | Vitest is faster than Jest, native ESM. Playwright is best-in-class for e2e.                                                                           |
| Linter      | Biome                               | Single binary, fast, replaces ESLint+Prettier. We accept the tradeoff of a smaller plugin ecosystem.                                                   |

---

## 3. Multi-tenancy — RLS is sacred

We use **shared-database, shared-schema** multi-tenancy with **PostgreSQL Row Level Security** as the enforcement boundary. Every tenant-scoped table has:

```sql
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT
```

And the policy:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

`FORCE ROW LEVEL SECURITY` matters: without it, the table owner bypasses RLS. We connect the application as `app_user`, a non-superuser role. The owner role (`app_admin`) is separate and reserved for ops tooling, with usage logged.

### How the API sets context

Every request that touches the database opens a transaction and runs:

```sql
SET LOCAL app.current_tenant_id = '<uuid>';
SET LOCAL app.current_user_id   = '<uuid>';
```

`SET LOCAL` scopes the GUC to the transaction — when the connection returns to the pool, no leakage. This is implemented in `apps/api/src/database/tenant-aware-db.service.ts` as a request-scoped Drizzle instance.

### Why not separate databases per tenant?

Operational cost. At 10,000 tenants, 10,000 databases means 10,000 migration runs, 10,000 backup configs, 10,000 connection-pool budgets. Postgres handles RLS at index-leaf level — properly indexed `(tenant_id, …)` queries are as fast as physically separate tables.

### Why not a per-tenant schema?

Same reason. Schemas multiply DDL cost without a meaningful security improvement over `FORCE ROW LEVEL SECURITY` + non-superuser app role.

### CI gate

`apps/api/test/integration/rls.spec.ts` creates two tenants, sets the GUC to tenant A, and asserts: SELECT returns only A's rows; UPDATE on B's rows from A's context affects 0 rows; INSERT with `tenant_id = B` from A's context fails. **This test must pass on every PR.**

---

## 4. Audit log

Every state-changing action is captured by a Postgres trigger function `fn_audit_log()` (`packages/db/sql/0004_audit_trigger.sql`). The trigger fires `AFTER INSERT/UPDATE/DELETE` on every audited table and writes:

| Column         | Source                                                |
| -------------- | ----------------------------------------------------- |
| `tenant_id`    | `NEW.tenant_id` ?? `OLD.tenant_id`                    |
| `actor_id`     | `current_setting('app.current_user_id')`              |
| `action`       | `TG_OP` (`INSERT` / `UPDATE` / `DELETE`)              |
| `resource_type`| `TG_TABLE_NAME`                                       |
| `resource_id`  | `NEW.id` ?? `OLD.id`                                  |
| `before_state` | `to_jsonb(OLD)` (for UPDATE/DELETE)                   |
| `after_state`  | `to_jsonb(NEW)` (for INSERT/UPDATE)                   |
| `ip_address`   | `current_setting('app.request_ip', true)`             |
| `user_agent`   | `current_setting('app.user_agent', true)`             |
| `request_id`   | `current_setting('app.request_id', true)`             |

The trigger is the source of truth. The `AuditInterceptor` in the API ensures the `SET LOCAL` context is correct before the transaction commits — it does not write the audit row directly. This means **direct database changes by ops are also audited**, and there's no "forgot to write the audit log" path.

---

## 5. Soft delete

Every business record has `deleted_at TIMESTAMPTZ`. Application queries filter `WHERE deleted_at IS NULL`. There is **no DELETE in the application path**. Hard purge is a scheduled job that respects retention policy and runs as `app_admin`.

---

## 6. UUIDv7

Generated in the API layer with a UUIDv7 library. UUIDv7 puts the timestamp in the high bits, so insertions are monotonic — no B-tree fragmentation, no random-page-write penalty. Comparable insertion performance to bigserial without the leakage. Database columns are `UUID`. Defaults are set via the application; the `pgcrypto` extension is loaded for the rare cases we need DB-side `gen_random_uuid()`.

---

## 7. Module boundaries

Path aliases are enforced via `tsconfig.base.json`:

```
@towcommand/db      -> packages/db/src/index.ts
@towcommand/shared  -> packages/shared/src/index.ts
@towcommand/ui      -> packages/ui/src/index.ts
```

`apps/web` does not import from `apps/api` or vice versa. `packages/db` is consumed only by `apps/api`. `packages/shared` is consumed by both apps.

---

## 8. Configuration

All env vars are validated at boot via Zod (`apps/api/src/config/config.schema.ts`). The app refuses to start if anything required is missing or malformed. **Loud failure beats silent default.**

---

## 9. Errors

The global `HttpExceptionFilter` returns RFC 9457 problem+json. All errors carry a `request_id` and a stable error code (see `packages/shared/src/constants/error-codes.ts`). Sentry is wired via `SENTRY_DSN`.

---

## 10. Idempotency for external writes

Stripe, Mapbox, motor club APIs (future) — every outbound write call carries an idempotency key derived from the originating tenant + resource + intent. Every call is logged with `request_id`, latency, status. This is implemented as a base `ExternalServiceClient` class.

---

## 11. Decisions to revisit later

- **Background workers:** BullMQ is in the stack but no workers are deployed in the scaffold. The first worker (audit-log purge, session cleanup) lands with the next milestone.
- **Multi-region:** RLS works trivially in a primary-replica setup. True multi-region active-active will require either Aurora-style or a tenant→region routing layer. Out of scope for the foundation.
- **Search:** Postgres FTS is fine for v1. ElasticSearch / OpenSearch is a v2 conversation when full-text scope grows.
- **Eventing:** No Kafka/Redpanda yet. `audit_log` is the de facto event log until we hit a use case that needs cross-service streaming.

---

## 12. The bar for new code

- Every new tenant table: add `tenant_id`, RLS policy, audit trigger, `deleted_at`.
- Every new endpoint: protected unless explicitly `@Public()`. Validated with Zod. Audited automatically by the trigger.
- Every new external call: idempotent, logged, with timeouts.
- Every new module: written in strict TypeScript, no `any`, with at least one integration test.

If you're tempted to weaken any of the above, you must first update this document with a written rationale and link to the discussion.
