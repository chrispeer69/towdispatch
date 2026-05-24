# Runbook — Region Failover (US-East → US-West)

**Audience:** the on-call owner. **Goal:** restore writes after a US-East
outage by promoting US-West. **RPO 60s · RTO 15 min.**

> Failover is **manual and irreversible**. Promoting the replica loses any
> writes not yet replicated (up to the current lag). Do not start until you are
> sure the primary is actually down. The scripts here are advisory — they probe
> and print steps; they never flip infrastructure.

---

## 1. Detection — is the primary really down?

The primary is "down" only when **writes** can't be served, not on a single
blip.

- Automated signal: `tsx scripts/ops/failover-check.ts`
  - Reads `PRIMARY_REGION_HEALTHCHECK_URL` / `SECONDARY_REGION_HEALTHCHECK_URL`
    (or `--primary` / `--secondary`).
  - Exit `1` + `primary UNREACHABLE` = candidate outage.
- Corroborate: Sentry error spike, Railway service status, `GET /ready` on
  US-East returning 503 or timing out.
- **Confirm on two consecutive checks ~60s apart.** A transient deploy or
  network blip is not a failover trigger.

Record the last good `region.replicaLagSeconds` — that is your **data-loss
estimate (RPO)**. Put it in the incident log.

## 2. Decision — fail over, or wait?

| Situation                                            | Action            |
|------------------------------------------------------|-------------------|
| Primary down < a few min, recovering, lag small      | **Wait.** Reads still served from US-West. |
| Primary down with no ETA, writes blocked             | **Fail over.**    |
| Primary up but replica lag > 60s climbing            | Investigate replication; do **not** promote. |
| Both regions unreachable                             | Provider-level incident — escalate, don't promote. |

Failing over has a cost: the RPO data-loss window + re-replication afterward.
Prefer waiting if recovery is imminent.

## 3. Execution

Run the runbook printer (it refuses without the ack flag):

```bash
tsx scripts/ops/promote-secondary.ts --i-acknowledge-data-loss
```

Then, by hand (also printed by the script):

1. **Promote** the US-West Postgres replica to a standalone primary
   (Railway dashboard → Database → Replica → *Promote to primary*).
2. **Reconfigure** the US-West API service:
   ```bash
   railway variables --set REGION_ROLE=primary
   railway variables --set DATABASE_URL=<promoted-db-url>
   railway variables --set DATABASE_READ_URL=<promoted-db-url>
   railway up
   ```
3. **Repoint DNS / edge**: update `api.<domain>` to the US-West service. Keep
   the record TTL low (≤ 60s) so the traffic cutover is fast.
4. **Verify**:
   ```bash
   tsx scripts/ops/failover-check.ts --primary https://api-west.<domain>/ready
   ```
   New primary must report `region.role=primary` and accept a test write.

Send the comms template (printed by `promote-secondary.ts`).

## 4. Rollback — returning to US-East after recovery

Only after US-East is healthy AND you've decided to move back:

1. Rebuild US-East's DB as a **replica of the now-primary US-West** (Railway:
   create a replica from US-West). Let it catch up — watch
   `region.replicaLagSeconds` until it's ~0.
2. Brief maintenance pause for writes (announce it).
3. Promote US-East back to primary; set US-East `REGION_ROLE=primary` with its
   own `DATABASE_URL`; set US-West back to `REGION_ROLE=secondary`.
4. Repoint DNS to US-East.
5. `failover-check.ts` against both — US-East primary, US-West secondary, lag
   converging.

A managed return-to-primary is preferable to an emergency one: do it in a low-
traffic window with a planned write pause.

## 5. Targets & known data-loss windows

| Metric | Target  | Notes                                                        |
|--------|---------|--------------------------------------------------------------|
| RPO    | 60s     | = max replication lag tolerated. Data written in the last `lag` seconds before an unplanned promotion is **lost**. |
| RTO    | 15 min  | Detection + promotion + DNS propagation. DNS TTL dominates — keep it low. |

**Not covered by this failover** (deferred, single-region today):
- Object storage (S3 evidence/photos) — not cross-region replicated.
- Redis — cache rebuilds in the new region; no state loss expected, brief cold
  cache.
