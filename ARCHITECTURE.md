# Tow Dispatch — Architecture

This document records the architectural decisions made in the foundational scaffold and the reasoning behind them. Read this before adding to the codebase. **Treat the invariants as law.**

---

## 1. North Star

Tow Dispatch is a multi-tenant SaaS designed to serve **10,000+ towing companies** and process **100M+ dispatched jobs per year**. Every decision in this codebase is made with that scale in mind. We optimize for:

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
@towdispatch/db      -> packages/db/src/index.ts
@towdispatch/shared  -> packages/shared/src/index.ts
@towdispatch/ui      -> packages/ui/src/index.ts
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

---

## 11. Phase 0 — additions through Session 17C

The original scaffold (Sessions 1–6) established the core: NestJS API, Next.js web, Postgres with RLS, audit log, JWT auth, dispatch board with Socket.IO. Phase 0 (Sessions 16, 17, 17A, 17B, 17C) hardened it for production with these additions.

### 11.1 Service inventory

```
apps/api/
  src/
    main.ts                          Fastify bootstrap: helmet (CSP), CORS, compression,
                                     cookie parsing, request-context middleware,
                                     ZodValidationPipe, GlobalExceptionFilter (problem+json),
                                     LoggingInterceptor (pino), Sentry, Socket.IO mounting
    app.module.ts                    Module composition graph
    common/
      decorators/                    @Public(), @Roles() decorators
      filters/                       GlobalExceptionFilter — RFC 9457 problem+json
      guards/                        JwtAuthGuard (global), RoleGuard
      interceptors/                  LoggingInterceptor, AuditInterceptor,
                                     HttpMetricsInterceptor (17A)
      middleware/                    request-context (uuid v7), raw-body for Stripe
      observability/                 MetricsService (prom-client),
                                     SentryService (no-op when DSN empty),
                                     SlowQueryService (250ms WARN),
                                     HealthMetricsController (/health /ready /metrics)
      pipes/                         ZodValidationPipe
      throttle/                      ThrottlerModule (Redis-backed; burst + sustained)
    config/                          loadConfig() with Zod schema; loud failure
    database/
      database.module.ts             APP_POOL + ADMIN_POOL + PoolBinder hook
                                     (wraps every checked-out client with SlowQueryService)
      tenant-aware-db.service.ts     runInTenantContext: BEGIN + SET LOCAL +
                                     drizzle bound to the tx + COMMIT
      transaction-runner.service.ts  Admin-pool path for signup, cross-tenant ops
    integrations/
      motor-club/                    AgeroStubProvider + MotorClubController (17B):
                                       POST /motor-club/agero/dispatch
                                       GET  /motor-club/agero/_test/outbox
      notification/                  Twilio + stub + PushMockService + PushMockController
      accounting/                    QBO provider (Session 12) + stub
      payment/                       Stripe Connect (Session 11) + stub
      maps/                          Mapbox client wrapper
      ecosystem/                     Ecosystem partner provider interface (Phase 2)
    modules/
      auth/                          AuthService with MFA-enforcement gate (17B):
                                       login() returns mfa_setup_required for OWNER/ADMIN
                                       without enrolled MFA; signMfaSetupRequired token
      jobs/                          jobs.service.ts — assign() returns 409 CONFLICT on
                                       cross-driver reassignment (17B)
      import/                        Towbook importer (Session 16) + reconciliation
      … (every Session 2–16 module)

apps/web/
  src/
    app/
      layout.tsx                     Root layout: skip link, ConnectivityBanner, Toaster
      not-found.tsx                  Branded 404 (17B)
      forbidden/page.tsx             Branded 403 (17B)
      global-error.tsx               Branded root-shell 500 (17B)
      (app)/
        layout.tsx                   Auth shell with id="main-content" anchor
        error.tsx                    Shell error boundary (17B)
        loading.tsx                  Shell skeleton (17B)
        … (every route)
    components/
      error-boundary.tsx             React class boundary with request-id surfacing
      connectivity-banner.tsx        online/offline banner (output aria-live)
      ui/skeleton.tsx                Skeleton primitives
      ui/empty-state.tsx             Reusable empty state
      ui/button.tsx                  Default variant uses orange-dark for AA contrast
      ui/input.tsx, label.tsx        Form primitives

apps/e2e/
  tests/                             10 E2E + perf-lighthouse (gated on
                                     E2E_RUN_REQUIRES_STACK=1)
  fixtures/
    skip-if-no-stack.ts              Opt-in gate
    api-client.ts                    Fast seeding via direct API calls
    push-mock.ts                     PushMock client for /push/_test/sent

packages/db/
  src/schema/                        Drizzle schemas
  sql/                               Raw SQL migrations (RLS, roles, audit, indexes)
```

### 11.2 Motor club gateway architecture

```
                ┌──────────────────────┐
                │ Agero (external)     │
                └─────────┬────────────┘
                          │ HTTPS POST (signed, Phase 1 HMAC verification)
                          ▼
┌────────────────────────────────────────────────────────────────────────┐
│ apps/api                                                               │
│                                                                        │
│  POST /motor-club/agero/dispatch                                       │
│    MotorClubController.dispatch()                                      │
│      1. Validate inbound payload                                       │
│      2. AgeroStubProvider.ingest()  (in-memory outbox for tests)       │
│      3. TransactionRunner.runAsAdmin: INSERT into jobs +               │
│         motor_club_dispatches in one transaction                       │
│      4. Return { jobId }                                               │
│                                                                        │
│  GET /motor-club/agero/_test/outbox  (NODE_ENV ≠ production)           │
│    Returns the captured outbound RPCs for test assertions              │
│                                                                        │
│  IntegrationRegistry  (lookup by category + provider-id)               │
│    motor-club -> agero-stub | agero-live (Phase 1) | aaa | honk …      │
└────────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
              motor_club_dispatches table
              (RLS, tenant-scoped, indexed by network + external_id)
```

The provider interface is in `apps/api/src/integrations/motor-club/motor-club-provider.interface.ts`. Adding a new motor club is: implement the interface, register it in `motor-club.module.ts`. The inbound HTTP shape stays stable across providers; only `acceptJob` / `updateStatus` / `submitInvoice` outbound semantics differ.

### 11.3 Payment architecture

```
Browser (Stripe Elements)        apps/api                              Stripe Connect
─────────────────────────       ─────────                              ──────────────
                                                                       Per-tenant Connect account
1. Customer opens /pay/<token>                                         (onboarded via /payments/connect/start)
2. Web calls POST /payments/intents
                              ─► PaymentsService.createIntent()
                                  - resolves tenant.stripe_connect_account_id
                                  - calls StripeProvider.createPaymentIntent({
                                      transfer_data: { destination: <tenant> },
                                      on_behalf_of: <tenant>
                                    })
                                  - persists Payment row (status='created')
                                                                       ◄─ paymentIntent.created
                              ◄─ { clientSecret }
3. Browser confirms with Elements
                                                                       ◄─ paymentIntent.succeeded
4. Stripe webhook POSTs /payments/webhook
                              ─► PaymentsWebhookController.handle()
                                  - verify signature (STRIPE_WEBHOOK_SECRET)
                                  - upsert stripe_events (idempotent)
                                  - PaymentsService.applyToInvoice()
                                    + transition invoice status
5. UI polls or socket updates
```

Refunds, setup intents, off-session charges follow the same shape. The webhook is the source of truth — payment row status only flips from a webhook, never from the synchronous response.

### 11.4 Authentication flow

```
Signup                                Login                                    MFA enforcement (17B)
──────                                ─────                                    ─────────────────────
POST /auth/signup                     POST /auth/login                         If user.role ∈ {OWNER, ADMIN}
  - creates tenant + OWNER              - rate-limit per email (per minute)      AND user.mfaEnabled = false:
  - returns AuthenticatedResponse       - argon2id verify password
    (tokens; OWNER, not MFA-gated       - if user.mfaEnabled:                     Return {
    yet because they have not             return { status: 'mfa_required',         status: 'mfa_setup_required',
    enrolled — they MUST enroll           mfaToken }                                setupToken,
    before next login)                  - else if MFA enforcement triggers:        role
                                          → mfa_setup_required (see right)       }
                                        - else:                                  → Client must complete
                                          return tokens                            /auth/mfa/setup +
                                                                                   /auth/mfa/verify-setup
                                                                                   before any access token

Refresh token rotation               Brute force lockout                       MFA challenge (existing)
────────────────────                 ───────────────────                       ────────────────────────
POST /auth/refresh                   5 failed in 15 min →                     POST /auth/mfa/login
  - hash incoming refresh             users.locked_until set                     - verify TOTP against
  - find sessions row by hash        - lockout_streak increments,                  encrypted secret
    AND revoked_at IS NULL             doubling backoff up to 24h               - return tokens
  - if found:                        - All attempts logged to
    * revoke the old session           login_attempts (email_hash)
    * issue new access + new
      refresh; stamp rotated_from_id
    * return tokens
  - if not found AND incoming
    matches a revoked session's
    historical hash:
    → token reuse detected
    → revoke entire family
      (sessions.family_id)
    → security event to Sentry
```

### 11.5 Observability architecture

```
Every request gets a request_id (uuid v7) via registerRequestContext.
That id flows through:

  - Pino structured log line on every response (LoggingInterceptor)
  - Sentry tags (SentryService.captureException sets tag request_id)
  - Outbound HTTP calls (Stripe, QBO, Mapbox) carry X-Request-ID
  - Frontend ErrorBoundary reads <meta name="x-request-id"> for the support ref ID
  - PostgreSQL set_config('app.request_id', ...) inside every tenant transaction,
    so audit_log captures it on every write

Slow query → WARN
Slow endpoint → WARN
Sentry captureException on every Error escaping the GlobalExceptionFilter
prom-client histograms on every HTTP request and every DB query
```

### 11.6 Critical invariants — checked in tests

| Invariant | Test |
|---|---|
| Tenant B cannot read Tenant A's records by ID | `apps/api/test/security/rls-bypass.spec.ts` |
| Each role's @Roles decorator is enforced | `apps/api/test/security/role-matrix.spec.ts` |
| The Towbook importer is idempotent (running twice = no dups) | `apps/api/test/integration/import.spec.ts` |
| Refresh-token reuse revokes the entire family | `apps/e2e/tests/e2e-005-auth-flows.spec.ts` |
| OWNER/ADMIN without MFA gets `mfa_setup_required`, not access tokens | `apps/e2e/tests/e2e-005-auth-flows.spec.ts` |
| Cross-tenant ID guess in the UI renders 404 not a leak | `apps/e2e/tests/e2e-004-tenant-isolation-ui.spec.ts` |
| Stripe `paymentIntent.succeeded` webhook is idempotent | `apps/api/test/integration/payments.spec.ts` |
| Inbound Agero dispatch creates job + motor_club_dispatches in one txn | `apps/e2e/tests/e2e-002-motor-club-dispatch.spec.ts` |
| Axe-core scan finds zero serious or critical violations on 7 primary pages | `apps/e2e/tests/e2e-009-a11y-smoke.spec.ts` |
| Lighthouse dashboard + dispatch meet Perf/A11y/BP thresholds | `apps/e2e/tests/perf-lighthouse.spec.ts` |
| Forward-only migration sequence + RLS on new tables | `scripts/check-migrations.sh` |
| Every production-required env var is documented + set | `scripts/check-env.sh` |

These tests gate every PR via `.github/workflows/e2e.yml`.

### 11.7 Phase 0 done. What's Phase 1.

Phase 1 prerequisites are tracked in `apps/PHASE_0_EXIT_REPORT.md` § "Phase 1 prerequisites". The summary:

- Live Agero ARES connector (the stub provider proves the shape)
- WAL archiving + PITR (effective RPO drops from 6h to 5min)
- Cross-region S3 replication
- PagerDuty + Slack alert routing (thresholds defined in `docs/observability.md`)
- Public status page
- MFA backup codes
- Push-provider mock → dispatch-events wiring
- Coordinated encryption-key rotation script
