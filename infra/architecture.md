# Multi-Region Architecture (Session 44)

Foundation for two-region operation: **primary US-East** (writes) + **secondary
US-West** (reads). Not active-active DB — see `regions.md` for why.

## Topology

```mermaid
flowchart TB
  client["Clients / Web / Mobile"]

  subgraph east["US-East — PRIMARY"]
    apiE["API (REGION_ROLE=primary)\naccepts reads + writes"]
    pgE[("Postgres PRIMARY")]
    redisE[("Redis")]
    apiE -->|read + write| pgE
    apiE --> redisE
  end

  subgraph west["US-West — SECONDARY"]
    apiW["API (REGION_ROLE=secondary)\nreads only; writes -> 503 + Location"]
    pgW[("Postgres READ REPLICA")]
    redisW[("Redis")]
    apiW -->|read only| pgW
    apiW --> redisW
  end

  client --> apiE
  client -.read traffic.-> apiW
  pgE ==>|streaming replication\n(async, lag = RPO)| pgW
  apiW -.503 + Location: primary.-> client
```

## Write pinning (the core invariant)

A request hitting the **secondary** is evaluated by a Fastify `onRequest` hook
(`apps/api/src/common/region/region.middleware.ts`, decision in
`write-guard.logic.ts`):

- **GET / HEAD / OPTIONS** → allowed (replicas serve reads).
- Exempt paths (`/health`, `/healthz`, `/ready`, `/readyz`, `/metrics`,
  `/admin/region*`, `/_debug`) → always allowed.
- **POST / PUT / PATCH / DELETE** on anything else → **503** with:
  - `Retry-After: 1`
  - `Location: <primary-origin><original-path>` (when the peer origin is known)
  - JSON body `{ code: service_unavailable, message, region, primary }`

The guard is **role-independent** (it runs before auth) — the rule is method +
path only. On the **primary** the hook is a pass-through.

Every response also carries `X-Region-Id` / `X-Region-Role` so operators and
clients can see which region answered.

## Read routing

`DATABASE_READ_URL` (optional) configures a read replica. Connection logic
(`apps/api/src/database/connection.ts` + `tenant-aware-db.service.ts`):

- Default for ALL data access is the **primary** pool (`APP_POOL`). A stale read
  is a bug; a write to a replica is data loss — so the bias is toward primary.
- Only `TenantAwareDb.runReadOnly(...)` (an explicit opt-in, `BEGIN ... READ ONLY`)
  routes to the replica, and only when a **distinct** `DATABASE_READ_URL` is set.
- When no distinct replica is configured, `REPLICA_POOL` is an **alias** of
  `APP_POOL` — single-region deploys keep exactly one runtime pool.

## Data flow on cutover

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Chk as failover-check.ts
  participant West as US-West (secondary)
  participant DNS as DNS / Edge

  Op->>Chk: probe both regions /ready
  Chk-->>Op: primary UNREACHABLE (exit 1)
  Op->>Op: confirm down on 2nd check (~60s apart)
  Op->>West: promote replica -> primary (Railway dashboard)
  Op->>West: REGION_ROLE=primary; DATABASE_URL=<promoted>; redeploy
  Op->>DNS: repoint api.<domain> -> US-West (low TTL)
  Op->>Chk: verify new primary accepts writes
```

## Replication-lag alerting (config only this session)

- `REPLICATION_LAG_ALERT_SECONDS` (default 60) = the RPO threshold.
- `GET /ready` exposes `region.replicaLagSeconds` (best-effort:
  `pg_last_xact_replay_timestamp()` on the replica; null when not measurable —
  may need a `pg_monitor` grant for `app_user`).
- `failover-check.ts` flags any region exceeding the threshold.
- **Wiring a live Sentry/alerting rule depends on Railway metrics export** and
  is deferred — the threshold + the surfaced metric are the hooks.

## Backwards compatibility

Every new env var defaults to a primary, single-region, no-replica deploy:
`REGION_ID=us-east`, `REGION_ROLE=primary`, no `DATABASE_READ_URL`, no
`PRIMARY_REGION_HEALTHCHECK_URL`. Existing deployments are unaffected.
