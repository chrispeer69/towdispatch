/**
 * SOC 2 / Availability evidence — disaster-recovery drill runbook + record
 * template (A1.2, A1.3; CC7.5 recovery).
 *
 * Type II requires the DR control to be *exercised* on a cadence (quarterly) and
 * evidenced. This collector emits a per-quarter drill record template the
 * operator fills in during the drill: the step-by-step failover runbook to the
 * Session 44 secondary region, the RPO/RTO targets to verify (RPO 60s, RTO
 * 15min), timing fields, and a sign-off block. It does NOT trigger a real
 * failover — a live failover is a scheduled ops maintenance event with
 * production blast radius (see SESSION_40_DECISIONS.md D8).
 *
 * renderDrillTemplate is pure so it unit-tests; run() writes the file.
 *
 * Usage:
 *   tsx scripts/compliance/dr-drill.ts [--out drill.md]
 */
import { writeFileSync } from 'node:fs';
import { type CollectorResult, exitCodeFor, isMain, printResult } from './_util';

export const RPO_SECONDS = 60;
export const RTO_MINUTES = 15;

/** Calendar quarter label, e.g. "2026-Q2". */
export function quarterLabel(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

export function renderDrillTemplate(now: Date = new Date()): string {
  const q = quarterLabel(now);
  return `# Disaster-Recovery Drill Record — ${q}

> SOC 2 A1.2 / A1.3 quarterly DR drill. Generated ${now.toISOString()}.
> Targets (from Session 44 multi-region): **RPO ${RPO_SECONDS}s**, **RTO ${RTO_MINUTES}min**.

## Participants

- Incident commander: ___________________
- Operator(s): ___________________
- Observer / scribe: ___________________
- Drill date / start time (UTC): ___________________

## Pre-drill checklist

- [ ] Stakeholders notified; drill announced (not a real incident).
- [ ] Secondary region replica confirmed healthy (\`GET /ready\` region block green).
- [ ] Latest backup age confirmed < RPO (\`verify-backup.ts\`).
- [ ] Region write-guard understood (primary returns 503 + Location on writes during cutover).

## Failover runbook (primary → secondary)

1. Declare drill; record T0.
2. Promote the secondary read replica to primary (Railway / DB console).
3. Flip the active-region pointer (REPLICA_POOL ⇄ APP_POOL aliasing per S44).
4. Update \`tenants.preferred_region\` routing if drilling a single-tenant cutover.
5. Verify write path on the new primary (create a synthetic record, then soft-delete it).
6. Verify \`GET /ready\` reports the new primary healthy; record T_recovered.
7. Smoke the critical read/write paths (login, create job, audit_log write).

## Measurements (fill in)

| Metric | Target | Observed |
|---|---|---|
| Data loss window (RPO) | ≤ ${RPO_SECONDS}s | __________ |
| Time to recovery (RTO) | ≤ ${RTO_MINUTES}min | __________ |
| Synthetic write succeeded on new primary | yes | __________ |
| audit_log captured the cutover actions | yes | __________ |

## Failback

1. Re-establish replication primary → original region once stable.
2. Flip the active-region pointer back during a maintenance window.
3. Confirm replica lag < RPO before declaring failback complete.

## Findings & actions

- What worked: ___________________
- What failed / was slow: ___________________
- Action items (owner, due date): ___________________

## Sign-off

- Incident commander: ___________________  Date: __________
- Reviewer (CTO): ___________________  Date: __________
`;
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const now = new Date();
  const md = renderDrillTemplate(now);
  const outIdx = argv.indexOf('--out');
  if (outIdx !== -1 && argv[outIdx + 1]) {
    writeFileSync(argv[outIdx + 1] as string, md, 'utf8');
  } else {
    // biome-ignore lint/suspicious/noConsoleLog: template to stdout is the point
    console.log(md);
  }
  return {
    status: 'ok',
    message: `DR drill template emitted for ${quarterLabel(now)} (RPO ${RPO_SECONDS}s / RTO ${RTO_MINUTES}min)`,
  };
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('dr-drill', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('dr-drill', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
