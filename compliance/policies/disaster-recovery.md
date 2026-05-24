# Disaster Recovery Policy (Region Failover)

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual (+ after every drill)

Complements [bcdr.md](bcdr.md) (backups / single-DB restore). This policy covers
**region-level failover**, enabled by the Session 44 multi-region foundation
(primary/secondary + read replicas).

## Objectives (region failover)

| Metric | Target | Source |
|---|---|---|
| **RPO** (max data loss) | ≤ **60 seconds** | streaming replication to secondary (S44) |
| **RTO** (max downtime) | ≤ **15 minutes** | promote secondary + flip active-region pointer |

> These supersede the daily-backup RPO/RTO in `bcdr.md` *for the region-failover
> scenario*. Backup/restore remains the fallback when replication is unavailable.

## Capability (from Session 44)

- Primary region + secondary region with read replicas.
- Region write-guard: the non-active region returns `503` + a `Location` header
  on writes (no split-brain writes).
- `REPLICA_POOL` aliases `APP_POOL`; `/ready` exposes a region-health block.
- `tenants.preferred_region` supports per-tenant routing.

> Note: this is primary/secondary failover, **not** active-active — a Railway DB
> limitation documented in the S44 report. The drill validates the manual
> promotion path.

## Drill cadence — quarterly

A DR drill is run **every quarter**. `scripts/compliance/dr-drill.ts` emits the
per-quarter drill record template (runbook, RPO/RTO measurement fields, sign-off).
The operator executes the runbook against the secondary, fills in the observed
RPO/RTO, and files the signed record under `compliance/evidence/` (retention
≥ 18 months). A live failover is a scheduled maintenance event — the script does
**not** trigger one (see [SESSION_40_DECISIONS.md](../../SESSION_40_DECISIONS.md) D8).

## Roles

- **Incident commander:** declares the drill/incident, owns the timeline.
- **Operator:** executes the promotion + pointer flip.
- **Reviewer (CTO):** signs off the drill record and tracks action items.

## Evidence

- Quarterly signed drill records in `compliance/evidence/`.
- `/ready` region-health samples (see [monitoring.md](monitoring.md)).
- `verify-backup.ts` confirms backup age < RPO as a pre-drill gate.
