# Session 44 Report — Multi-Region Active-Active (foundation)

## TL;DR

Laid the rails for two-region operation (**primary US-East / secondary
US-West**). Because the managed-Postgres provider can't host the DB
active-active today, v1 = **read replicas + region-aware write pinning +
write-region-pinned + automated failover runbook**. Every region runs the same
image; role is per-deploy. The secondary refuses tenant writes (503 + `Location`
→ primary); reads opt into the replica; `/ready` reports region + replica lag;
two ops scripts (read-only health check + an advisory, refuse-by-default
promotion runbook) round it out. Real cutover is owner-driven — this session
ships the rails, not the flip.

Verification: workspace typecheck ✅ · 444 API tests pass (27 new region, 0
fail; DB-gated specs skip locally) ✅ · full build (shared/db/ui/web/api) ✅ ·
biome clean on changed files ✅. Caught + fixed a config bug that would have
crashed every single-region boot (see decisions §12).

## What shipped (✅)

- **infra/** — `regions.md` (topology, what's replicated, RPO/RTO),
  `architecture.md` (mermaid topology + cutover sequence, write-pin + read-route
  rules), `railway/region-config.md` (per-region services, env-var deltas, CLI).
- **Region awareness** — `apps/api/src/common/region/`: pure `write-guard.logic`,
  `RegionContextService`, Fastify `registerRegionGuards` hook (write block +
  last-write marker + `X-Region-*` headers), `RegionController`
  (`GET /admin/region`, `GET /admin/region-status`, owner/admin-gated),
  `RegionModule` (@Global). Wired into `main.ts` + `app.module.ts`. Region tags
  (`region_id`/`region_role`) added to the pino `base` so every log line is
  region-stamped.
- **Env** — `REGION_ID`, `REGION_ROLE`, `PRIMARY_REGION_HEALTHCHECK_URL`,
  `DATABASE_READ_URL`, `REPLICATION_LAG_ALERT_SECONDS` (+ `ConfigService.region`,
  `databaseReadUrl`, `readReplicaConfigured`). All default to a primary,
  single-region, no-replica deploy.
- **Read replica** — `REPLICA_POOL` token (aliases `APP_POOL` when no distinct
  replica → no extra connections), `database/connection.ts` pure `selectPoolToken`,
  `TenantAwareDb.runReadOnly` (`BEGIN ... READ ONLY`, replica-routed) +
  `replicaLagSeconds` best-effort probe.
- **Health** — `GET /ready` additively returns
  `region.{regionId,role,replicaLagSeconds,lastWriteTs}`; `/healthz`/`/readyz`
  untouched.
- **Tenant pin** — `0039_tenant_preferred_region.sql` (idempotent, nullable, no
  CHECK) + Drizzle `tenants.preferredRegion`. `X-Preferred-Region` validated +
  echoed; routing deferred to edge.
- **Failover automation** — `scripts/ops/failover-check.ts` (read-only dual-region
  `/ready` probe, lag flag, exit codes), `scripts/ops/promote-secondary.ts`
  (refuses without `--i-acknowledge-data-loss`; prints runbook + comms template,
  never flips infra). npm scripts `ops:failover-check`, `ops:promote-secondary`.
- **Runbook** — `docs/ops/region-failover.md` (detection → decision → execution →
  rollback, RPO/RTO + known data-loss windows).
- **Shared contracts** — `packages/shared/src/region/` (region id/role/info/
  health/status Zod + `PREFERRED_REGION_HEADER`) + barrel export.
- **Tests** — `write-guard.logic.spec` (12), `connection.spec` (3, pool
  selection), `config/region-resolution.spec` (7, env resolution + replica
  getters), `test/integration/region-failover.spec` (5, hermetic Fastify:
  secondary POST→503+Location, GET allowed, exempt path, primary write marks
  lastWrite, failed write doesn't).

## Decision log

See `SESSION_44_DECISIONS.md`. Headlines: active-active→primary/secondary v1
(provider limit); 503+Location over proxy; role-independent Fastify guard;
replica pool aliases primary when unset; `/ready` additive; nullable pin column,
no CHECK; promotion stays a human step; RPO 60s / RTO 15min.

## Deferred (🟡)

DNS/edge geo-routing; automated promotion; multi-region object storage;
active-active writes (needs distributed DB); Redis cross-region; routing on the
region preference; live Sentry lag-alert wiring (needs Railway metrics export).

## What was NOT touched

Business modules, auth, RLS policies, existing migrations, impound/lien schemas,
`scripts/check-migrations.sh`. Only schema change: additive nullable
`tenants.preferred_region` (0039). Single-region operation is byte-for-byte
backwards-compatible (all new env defaults to primary/us-east/no-replica).

## Known issues

- DB-gated specs (RLS + integration) self-skip locally without Postgres; they run
  in the docker/CI DB path (mirrors every other module).
- `replicaLagSeconds` may return null on a real replica until `app_user` is
  granted `pg_monitor` (documented in the runbook).
- `lastWriteTs` is an in-process write-intent marker, not a DB-commit time
  (documented in the contract).

## Commands

```bash
pnpm -r run typecheck
pnpm -F @ustowdispatch/api test            # 444 pass (27 region); DB specs skip
pnpm -r run build
pnpm exec biome check apps/api/src/common/region packages/shared/src/region scripts/ops
# ops
pnpm ops:failover-check --primary https://api.<domain>/ready --secondary https://api-west.<domain>/ready
pnpm ops:promote-secondary                  # refuses; prints runbook with --i-acknowledge-data-loss
# enable a secondary deploy: REGION_ID=us-west REGION_ROLE=secondary DATABASE_URL=<replica>
```
