# Session 44 — Multi-Region Active-Active (foundation): Decisions Log

**Scope:** lay the rails for two-region operation (primary US-East, secondary
US-West): infra docs, region-aware write pinning, read-replica routing, deeper
health probes, a tenant region-pin column, advisory failover scripts, and a
runbook. No live infrastructure was flipped — the real cutover is owner-driven.

---

## 1. ⚠️ "Active-active" → primary/secondary + read replicas (v1)

The brief is titled *active-active*. **What ships is primary/secondary with
read replicas + region-aware write pinning + automated failover runbook — NOT a
true active-active database.** Why: the managed-Postgres providers we run on
(Railway today) cannot host the DB active-active. Multi-primary writes need a
globally-distributed DB (Spanner/CockroachDB/Aurora multi-master class), which
is a platform migration, not a feature. So:

- **Primary takes all writes.** Secondary serves reads and refuses tenant writes.
- This is the honest, shippable rail. When the DB platform can do active-active,
  the write guard becomes a no-op flag flip; the region plumbing stays.

Called out loudly here, in `infra/regions.md`, and in the PR body so nobody
mistakes the foundation for the destination.

## 2. Write guard returns 503 + Location (not a proxy)

A write hitting the secondary gets **503 + `Retry-After` + `Location` → primary**,
not a transparent reverse-proxy to the primary.

- **Chosen:** 503 + Location. Simple, observable (the refusal is logged and
  shows in metrics), no cross-region request fan-out from inside the API, no
  doubled latency/timeout surface. The client (or edge) retries against primary.
- **Rejected:** proxying the write from secondary → primary. Hides the
  cross-region hop, couples the secondary's availability to the primary's, and
  turns every secondary into a latency-adding middlebox. Routing belongs at the
  edge/DNS layer, owner-side.

## 3. Write guard is a Fastify hook, role-independent

Implemented as a Fastify `onRequest` hook (`registerRegionGuards`), mirroring the
existing `registerRequestContext`. It runs **before** Nest's auth phase, so it
cannot see the actor's role — and it doesn't need to: the block rule is
**method + path only** (write method, not an exempt path). Decision logic is
extracted to a pure function (`write-guard.logic.ts`) and unit-tested in
isolation. Exempt prefixes: `/health`, `/healthz`, `/ready`, `/readyz`,
`/metrics`, `/admin/region*`, `/_debug` (the last is the smoke-harness boom
endpoint).

## 4. Read-replica pool aliases the primary when no distinct replica is set

`DATABASE_READ_URL` is optional. When unset (or identical to `DATABASE_URL`),
`REPLICA_POOL` is wired as the **same instance** as `APP_POOL` — every existing
single-region deploy keeps exactly one runtime pool, no doubled pg connection
slots. A separate, smaller pool (max 10) is created only when a genuinely
distinct replica URL is configured. Pool selection (`selectPoolToken`) is pure
and unit-tested. **Default for all data access is the primary** — a stale read
is a bug, a write to a replica is data loss, so the bias is toward primary.
Reads opt in explicitly via `TenantAwareDb.runReadOnly` (`BEGIN ... READ ONLY`).

## 5. `/ready` deepened additively; `/readyz` left as-is

`GET /ready` gains a `region` block (`regionId`, `role`, `replicaLagSeconds`,
`lastWriteTs`) **without** changing the existing `status`/`checks` fields —
probes only check the status code, so adding fields is safe. `/healthz` and
`/readyz` (the older aliases the deploy pipeline points at) are untouched.

## 6. `replicaLagSeconds` and `lastWriteTs` are best-effort, documented as such

- `replicaLagSeconds`: queried from the replica via
  `pg_last_xact_replay_timestamp()`. Returns **null** when no distinct replica
  exists or when the monitoring function isn't grantable to `app_user` (may need
  a `pg_monitor` grant — noted in the runbook). Never throws — readiness must not
  fail because lag is unknowable.
- `lastWriteTs`: an **in-process** marker stamped when the primary accepts a
  write-intent request (2xx/3xx). It is a coarse "is this region taking writes"
  signal for failover, **not** a DB-commit timestamp. Documented in the contract.

## 7. Tenant region pin: nullable column, NO CHECK constraint

`0039` adds `tenants.preferred_region` as **nullable `text` with no CHECK**. The
whole point of the foundation is forward-compatibility for more than two
regions; `CHECK (... IN ('us-east','us-west'))` would lock us to today's two and
force a migration to add a third. Allowed values are validated at the app input
boundary (Zod `regionIdSchema`). The migration is idempotent (DO-block guard);
the tenants audit trigger is column-agnostic (`to_jsonb(NEW)`), so the ALTER is
safe.

## 8. `X-Preferred-Region` is validated + echoed, NOT routed

Per the brief, actually routing on the preference is edge/DNS work (owner-side)
and out of scope. The API validates the header against `regionIdSchema` and
acknowledges it (`X-Preferred-Region-Ack` response header). Every response also
carries `X-Region-Id` / `X-Region-Role`. No routing decision is made on it yet.

## 9. Promotion stays a human step; the script refuses by default

`scripts/ops/promote-secondary.ts` performs **no** live cutover. It refuses to
run without `--i-acknowledge-data-loss`, and even then only **prints the
ordered runbook + comms template**. Promotion is irreversible and lossy (the RPO
window); per CLAUDE.md and the brief, the owner does the flip by hand.
`failover-check.ts` is read-only (probes both regions' `/ready`).

## 10. RPO / RTO targets

- **RPO 60s** — max tolerated data loss = replication lag.
  `REPLICATION_LAG_ALERT_SECONDS` (default 60) is the alert threshold; surfaced
  on `/ready` and flagged by `failover-check.ts`.
- **RTO 15 min** — detection + promotion + DNS propagation. DNS TTL dominates;
  keep the `api.<domain>` record TTL ≤ 60s.

## 11. Sentry replication-lag alert — config only this session

The threshold env var + the surfaced `replicaLagSeconds` metric are the hooks. A
live Sentry/alerting rule depends on Railway exporting replication metrics, which
isn't wired yet — deferred and documented in `infra/architecture.md`.

## 12. Config bug caught by tests (worth recording)

`PRIMARY_REGION_HEALTHCHECK_URL` was first written as
`z.string().url().optional().default('')`. Zod **re-validates the default**, and
`''` fails `.url()`, which would have crashed the boot of **every single-region
deploy** (the default case). Fixed to `.optional()` (no default); the getter
coerces `undefined → ''`. The region-resolution spec is what surfaced it.

---

## Deferred (🟡)

- **DNS-based geo-routing / edge worker** — provider-dependent, owner-side.
- **Automated promotion** — stays a deliberate human step.
- **Multi-region object storage** — S3 evidence/photos are single-region.
- **Active-active writes** — needs a globally-distributed DB (platform change).
- **Redis cross-region** — cache rebuilds in the new region on cutover.
- **Routing on `X-Preferred-Region` / `preferred_region`** — edge/DNS layer.
- **Live Sentry lag alert wiring** — depends on Railway metrics export.

## What was NOT touched

Business modules, auth, RLS policies, existing migrations, the impound/lien
schemas, `scripts/check-migrations.sh`. The only schema change is the additive,
nullable `tenants.preferred_region` column (0039). All new env defaults make a
single-region primary deploy behave exactly as before.
