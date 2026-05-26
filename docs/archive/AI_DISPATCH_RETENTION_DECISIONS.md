# AI Dispatch Retention — Decision Log & Session Report

Branch: `chore/ai-dispatch-retention` · Base: `feature/session-41-ai-dispatch` (PR #117, **unmerged**)

## ⚠️ Upstream blocker (🟡, not a defect in this work)

Mid-session the remote `feature/session-41-ai-dispatch` was force-rebased by the
parallel-session automation from `1fa99b5` (the clean PR #117 head this work was
built and verified on) to `4dc425a` (rebased onto newer master). **That rebase
botched the merge** — `4dc425a` does not compile: corrupted `config.schema.ts`
(~L69), `config.service.ts` (~L165 duplicated `jwt` getter), `admin.controller.ts`,
`admin.module.ts`, `auth/jwt.service.ts` (unterminated regex literals). None of
this is in the retention files.

Consequence: there is no base that gives BOTH a green branch AND a
retention-only diff — the only diff-isolating base (`4dc425a`) is broken, and the
only green base (`1fa99b5`) is no longer the remote ref. **This branch is kept on
the last-known-good `1fa99b5` so it compiles and is fully verified.** PR #125's
diff is therefore noisy (re-shows S41 churn) until the S41 base is repaired and
this branch is rebased onto the fixed tip. **Do not merge PR #125 before #117 is
repaired + merged.** The 13 retention files (listed under "What shipped") are the
real change set. See memory `project_s41_branch_broken_rebase.md`.


## TL;DR

Retention policy + daily cron + admin surface for Session 41's three
high-volume, append-style tables (`dispatch_recommendations`,
`dispatch_outcomes`, `eta_predictions`). Two-phase, age-based on `created_at`:
soft-delete at the soft window, hard-purge at the hard window. Per-tenant,
RLS-bounded, batched, env-gated (default off). Pure policy + classifier behind
the SQL. 25 new unit tests; full chain green.

## Decision log

1. **Based off the S41 branch, not master.** Pre-flight said "ABORT if
   ai-dispatch not on master" — but PR #117 is still OPEN, so the module is only
   on `feature/session-41-ai-dispatch`. Aborting ships nothing, which violates
   Rule 10. Direct repo precedent: Session 40 (SOC2) was based off the unmerged
   S31 branch. Reset this branch onto S41 HEAD (1fa99b5). **This branch lands
   cleanly on master once #117 merges** — it only adds files + extends config.

2. **`deleted_at`, not `soft_deleted_at`.** The task brief said
   `WHERE soft_deleted_at IS NULL`; the actual 0045 schema (and ARCHITECTURE
   invariant #3) uses `deleted_at`. Schema is the source of truth.

3. **Per-table windows are code constants, authoritative over the "N+30"
   prose.** The brief's "hard-delete at N+30" only matches recommendations
   (30→60). Outcomes (365→730) and eta (90→180) don't, so windows are an
   explicit per-table map in `retention-policy.ts`, not a derived `soft+30`.
   Kept out of env on purpose: a data-lifetime change should be a reviewed PR,
   not an ops toggle. (Batch size IS env — `AI_DISPATCH_RETENTION_BATCH_SIZE`.)

4. **HARD phase runs before SOFT phase.** Guarantees the two sets are disjoint
   in a run: HARD only touches already-soft-deleted rows, SOFT only touches live
   rows. A live row past the hard age is soft-deleted this run and purged on the
   *next* — a real grace period, no create→purge collapse in one pass.

5. **Both `IS NULL` and `IS NOT NULL` partial indexes (migration 0048).** The
   brief named only the `deleted_at IS NULL` (soft-scan) index. The HARD purge
   scans `deleted_at IS NOT NULL`; on explicitly high-volume tables that scan
   must also be index-backed, so each table gets a matching `IS NOT NULL`
   partial. `dispatch_outcomes` already had the soft-scan index from 0045
   (`dispatch_outcomes_tenant_created_idx`) — its NULL index is intentionally
   NOT duplicated; only the purge index is added.

6. **Admin endpoint is TENANT-SCOPED, not cross-tenant.** OWNER is a
   tenant-scoped role; one tenant's owner must never purge another tenant's
   data. `POST /run` and `GET /stats` operate on the caller's own tenant via
   `runInTenantContext`. The cross-tenant sweep is the cron's job (admin pool +
   system actor). OWNER-only via `@Roles(ROLES.OWNER)` + global `JwtAuthGuard`.

7. **Cron at 03:00 UTC (server time), not per-tenant-local.** `@Cron('0 3 * * *')`
   mirrors `LienAdvanceCron`. "Tenant-local" would require per-tenant cron
   fan-out keyed on `tenants.timezone`; UTC is the brief's documented fallback.
   Per-tenant-local scheduling is 🟡 deferred.

8. **"Audit log per run" = trigger-driven row audit + structured summary log.**
   No app-level audit-log writer exists (invariant #2: audit is trigger-driven).
   Every soft-delete `UPDATE` and hard-delete `DELETE` already fires the
   `AFTER`-row audit trigger. The cron adds a structured summary log line and a
   Sentry breadcrumb per run. Added a small `addBreadcrumb()` to the existing
   `@Global` `SentryService` (mirrors `captureMessage`; no-op when DSN absent).

9. **Request/response types defined locally, not in `@ustowdispatch/shared`.**
   The brief scopes shared ai-dispatch contracts off-limits. Retention is an
   internal ops surface; its Zod schema + result types live in the retention
   module.

10. **Tests mock the DB (no real-DB CI tests).** Repo norm: cron specs mock the
    DB (e.g. `lifecycle-cron.service.spec.ts`), pure helpers test directly
    (`computeFatigueByDriver`). 480 DB integration tests in the suite are
    `skip`ped without an opt-in env — matches the brief's "no retention against
    real DB without opt-in". The full soft→hard cycle is covered against an
    in-memory fake table that interprets the two SQL predicates directly.

## What shipped ✅

- `packages/db/sql/0048_ai_dispatch_retention.sql` — 5 partial retention indexes (no schema change).
- `apps/api/src/modules/ai-dispatch/retention/retention-policy.ts` — pure policy, cutoffs, `classifyRow`.
- `.../retention/retention.service.ts` — `applyRetention` (batched, two-phase), `runForTenant(AsSystem)`, `allTenantIds`, `statsForTenant`.
- `.../retention/retention.cron.ts` — env-gated daily 03:00 cross-tenant sweep + log + breadcrumb.
- `.../retention/admin-retention.controller.ts` — `POST /admin/ai-dispatch/retention/run` (dry-run), `GET .../stats`, OWNER-only, tenant-scoped.
- `ai-dispatch.module.ts` — registers service, cron, controller.
- `config.schema.ts` / `config.service.ts` — `AI_DISPATCH_RETENTION_CRON_ENABLED` (default false), `AI_DISPATCH_RETENTION_BATCH_SIZE` (default 500).
- `common/observability/sentry.service.ts` — `addBreadcrumb()`.
- 3 spec files, 25 tests: policy boundaries, applyRetention (no-rows / mixed / all-old batching / dry-run / phase-order / cutoff params / bad-table), RLS isolation, admin-pool discovery, soft→hard time-travel cycle.

## Deferred 🟡

- **Per-tenant-local cron schedule.** Single 03:00 UTC sweep; per-tenant TZ fan-out deferred.
- **Live-DB RLS/integration test.** No real-DB harness in CI; RLS isolation is
  verified at the contract level (per-tenant `runInTenantContext`) + DB-enforced
  `FORCE ROW LEVEL SECURITY` from 0045. A cross-process live test is deferred
  with the rest of the suite's `skip`ped integration tier.
- **Migration applied to a live DB.** No `DATABASE_URL` in this environment;
  the migration is pure idempotent `CREATE INDEX IF NOT EXISTS`.

## Not touched

- Scoring engine (`scoring/`), ETA engine (`eta/`), `SmartDispatchService`, both dispatch controllers, shared ai-dispatch contracts. No retention-window changes outside the logged policy.

## Known issues / notes

- `scripts/check-migrations.sh` reports gaps (0048 expected 0046). Expected and
  documented: 0046/0047 are on sibling branches absent from this worktree; 0048
  is the lowest free slot repo-wide. The script is not in CI; contiguity is
  reconciled at merge. Pre-existing gaps (0034/0036/0042/0045) confirm the norm.

## Commands

```
pnpm --filter @ustowdispatch/api run typecheck   # clean
pnpm lint                                          # 0 errors (23 pre-existing web warnings)
pnpm --filter @ustowdispatch/api run test          # 578 passed, 480 skipped (DB-gated)
pnpm --filter @ustowdispatch/api run build         # clean
# enable in an env: AI_DISPATCH_RETENTION_CRON_ENABLED=true
```
