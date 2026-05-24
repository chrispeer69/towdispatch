/**
 * promote-secondary.ts (Session 44) — failover RUNBOOK script (advisory).
 *
 * This script does NOT perform a live cutover. Promoting a replica to primary
 * and repointing traffic is irreversible and lossy (any writes not yet
 * replicated are gone). Per CLAUDE.md and the session scope, the actual flip is
 * owner-driven, by hand. This script:
 *   1. refuses to run without --i-acknowledge-data-loss,
 *   2. prints the exact, ordered manual steps + Railway CLI snippets,
 *   3. emits the comms template and the rollback pointer.
 *
 * Usage:
 *   tsx scripts/ops/promote-secondary.ts                          # prints warning, exits 2
 *   tsx scripts/ops/promote-secondary.ts --i-acknowledge-data-loss
 *
 * Pure Node (no app imports), runs via tsx.
 */
const ACK = '--i-acknowledge-data-loss';

const RUNBOOK = `
SECONDARY PROMOTION — MANUAL STEPS (execute in order)
=====================================================
Pre-flight:
  1. Confirm the primary is actually down (not a transient blip):
       tsx scripts/ops/failover-check.ts
     Primary must be UNREACHABLE on two consecutive checks ~60s apart.
  2. Note the replica lag from the last successful check — that lag window is
     your DATA-LOSS estimate (RPO). Record it in the incident log.

Promote (Railway, owner's hands):
  3. Promote the US-West replica database to a standalone primary:
       railway link            # select the us-west project
       railway service          # select the Postgres service
       # In the Railway dashboard: Database → Replica → "Promote to primary".
       # (Railway has no stable CLI verb for promotion yet — use the dashboard.)
  4. Point the US-West API service at its now-primary DB and flip its role:
       railway variables --set REGION_ROLE=primary
       railway variables --set DATABASE_URL=<promoted-db-url>
       railway variables --set DATABASE_READ_URL=<promoted-db-url>
       railway up              # redeploy us-west API as the new primary
  5. Repoint DNS / edge to US-West (owner-side; depends on provider):
       # Update the api.<domain> record / edge route to the us-west service.
       # TTL on the record is your traffic-cutover time (keep it low: <=60s).

Verify:
  6. tsx scripts/ops/failover-check.ts --primary https://api-west.<domain>/ready
     New primary must report region.role=primary and accept writes.

Rollback (after the original region recovers): docs/ops/region-failover.md §Rollback.

COMMS TEMPLATE
==============
  [STATUS] We are failing over to our US-West region after a US-East outage.
  Service may be briefly unavailable for writes during the switch. Reads are
  unaffected. ETA to full restore: ~15 minutes. Next update in 15 minutes.
`;

const REFUSAL = `
promote-secondary: REFUSING TO PROCEED.

Promotion is IRREVERSIBLE and may LOSE DATA (any writes not yet replicated
to the secondary are permanently lost). This script never performs the
cutover itself — it prints the runbook. Re-run with ${ACK} once you have
confirmed the primary is truly down and accepted the data-loss window.

See docs/ops/region-failover.md before doing anything.
`;

function main(): void {
  if (!process.argv.includes(ACK)) {
    process.stderr.write(REFUSAL);
    process.exit(2);
  }
  process.stdout.write(RUNBOOK);
  process.stdout.write(
    '\nThis script printed the runbook only. No infrastructure was changed.\nExecute the steps above by hand.\n',
  );
}

main();
