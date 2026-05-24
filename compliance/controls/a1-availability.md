# Control: Availability (A1)

**Objective.** The system is available for operation and use as committed.
(In scope for this Type I alongside Security.)

## Design

- **Capacity (A1.1).** Managed PostgreSQL + Redis on Railway; horizontal scale
  of the API/web services; Socket.IO scales out via the Redis adapter. Metrics
  (prom-client) and slow-query/endpoint WARN provide capacity signal (CC4).
- **Backup & recovery (A1.2).** Railway managed Postgres takes **daily**
  automated backups. Target **RPO ≤ 24h** today (WAL archiving / PITR to drop
  RPO to ~5 min is a Phase 1 item per `ARCHITECTURE.md §11`). Backup recency is
  asserted by `scripts/compliance/verify-backup.ts` (warns/fails if the last
  backup is older than 24h).
- **Recovery testing & DR (A1.3).** The restore procedure and roles are
  documented in [policies/bcdr.md](../policies/bcdr.md). An **annual restore
  drill** restores the latest backup to a scratch environment, measures the RTO
  achieved, and files the result in `compliance/evidence/`. Target **RTO ≤ 4h**.
- **Health & monitoring.** `/health` (liveness) and `/ready` (readiness, incl.
  DB ping) back platform health checks and the public status page.

## Evidence

- `verify-backup.ts` output (backup < 24h).
- Annual restore-drill record (RTO achieved) in `compliance/evidence/`.
- Railway backup configuration screenshot; status-page history.

**Owner:** CTO.
