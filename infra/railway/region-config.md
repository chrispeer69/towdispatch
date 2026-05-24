# Railway — per-region service configuration (Session 44)

How to stand up the two regions on Railway. Today only US-East exists; this is
the recipe to add US-West as a read-replica secondary, and the env-var deltas
between the two.

> Nothing here flips production. Standing up the secondary and any cutover are
> owner-driven, by hand. See `docs/ops/region-failover.md`.

## Services per region

| Service           | US-East (primary)        | US-West (secondary)              |
|-------------------|--------------------------|----------------------------------|
| API               | `ustowdispatch-api`      | `ustowdispatch-api-west`         |
| Postgres          | primary instance         | **read replica** of US-East      |
| Redis             | own instance             | own instance (not replicated)    |

## Env-var deltas

Most env is identical across regions (same JWT secret, same Stripe keys, etc.).
The region-specific deltas:

| Var                              | US-East (primary)                    | US-West (secondary)                       |
|----------------------------------|--------------------------------------|-------------------------------------------|
| `REGION_ID`                      | `us-east`                            | `us-west`                                 |
| `REGION_ROLE`                    | `primary`                            | `secondary`                               |
| `DATABASE_URL`                   | US-East primary DB                   | US-West replica DB                        |
| `DATABASE_READ_URL`              | *(unset — reads from primary)*       | US-West replica DB (same as DATABASE_URL) |
| `PRIMARY_REGION_HEALTHCHECK_URL` | `https://api-west.<domain>/ready`    | `https://api.<domain>/ready`              |
| `REPLICATION_LAG_ALERT_SECONDS`  | `60`                                 | `60`                                      |

Notes:
- `PRIMARY_REGION_HEALTHCHECK_URL` is each region's view of **the other** region
  (it's the peer probe + the `Location` redirect target). Name is historical —
  it points at the peer.
- On the secondary, `DATABASE_URL` already points at the replica, so a distinct
  `DATABASE_READ_URL` is optional there.

## CLI snippets

```bash
# Link the CLI to the US-West project/service
railway link                       # pick the us-west project
railway service                    # pick ustowdispatch-api-west

# Set the secondary's region identity
railway variables --set REGION_ID=us-west
railway variables --set REGION_ROLE=secondary
railway variables --set PRIMARY_REGION_HEALTHCHECK_URL=https://api.<domain>/ready
railway variables --set REPLICATION_LAG_ALERT_SECONDS=60

# Point it at the replica DB (Railway: add a Postgres replica, copy its URL)
railway variables --set DATABASE_URL=<us-west-replica-url>

# Deploy
railway up

# Confirm role + reachability from your laptop
tsx scripts/ops/failover-check.ts \
  --primary  https://api.<domain>/ready \
  --secondary https://api-west.<domain>/ready
```

## Health & probes

- Railway healthcheck path: `/ready` (already used by US-East). It now also
  returns `region.{regionId,role,replicaLagSeconds,lastWriteTs}`.
- `/healthz` and `/readyz` remain as aliases for any existing probe config.

## Migrations across regions

Run migrations against the **primary only**. The replica receives schema changes
via streaming replication. Never run `db:migrate` against a replica
(`DATABASE_ADMIN_URL` should be the primary's superuser URL on the primary
region's deploy; the secondary does not run migrations).
