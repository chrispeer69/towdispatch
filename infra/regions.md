# Regions

US Tow Dispatch multi-region topology (Session 44 foundation).

> **Posture, up front:** the public goal is "active-active across two regions."
> What ships in v1 is **primary / secondary with read replicas + region-aware
> write pinning + an automated failover runbook** — *not* a true active-active
> database. The managed-Postgres providers (Railway today) cannot host the DB
> active-active. This session lays the rails so the real cutover is a
> configuration + DNS change, owner-driven. See `SESSION_44_DECISIONS.md`.

## Regions

| Region   | id        | Role (today) | Hosts                                   |
|----------|-----------|--------------|-----------------------------------------|
| US-East  | `us-east` | **primary**  | API (write), Postgres primary, Redis    |
| US-West  | `us-west` | secondary    | API (read-only), Postgres read replica  |

Each region runs the full API image. Role is set per-deploy via `REGION_ROLE`.
The **primary takes all writes**; the **secondary serves reads** and refuses
tenant writes (503 + `Location` → primary).

## What is replicated

| Data                     | Mechanism                          | Notes                              |
|--------------------------|------------------------------------|------------------------------------|
| Postgres (all tenant DB) | streaming read replica (us-west)   | async; lag is the RPO driver       |
| Object storage (S3)      | **not** cross-region yet (deferred)| evidence/photos single-region      |
| Redis                    | **not** replicated                 | cache/ephemeral; rebuilt on cutover|

## RPO / RTO targets

| Target | Value      | Meaning                                                              |
|--------|------------|----------------------------------------------------------------------|
| RPO    | **60s**    | Max acceptable data loss = replication lag. Alert when lag > 60s.     |
| RTO    | **15 min** | Max time to restore writes via manual cutover (promote + DNS).       |

Replication lag is surfaced on `GET /ready` (`region.replicaLagSeconds`) and
flagged by `scripts/ops/failover-check.ts` against `REPLICATION_LAG_ALERT_SECONDS`.

## Out of scope this session (deferred)

- DNS-based geo-routing / edge worker (provider-dependent, owner-side).
- Automated promotion (promotion stays a deliberate human step).
- Multi-region object storage (S3 cross-region replication).
- Active-active writes (needs a globally-distributed DB — not Railway today).
