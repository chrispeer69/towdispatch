/**
 * `pnpm compliance:type2-check` — SOC 2 Type II + PCI smoke test (Session 40).
 *
 * The Type II analogue of S31's `compliance:check`. Three layers:
 *
 *   1. COVERAGE MATRIX (structural). Every Type II / PCI control area must have a
 *      named collector script on disk. A missing collector fails the build —
 *      this is the "coverage matrix complete" gate.
 *   2. CORPUS (structural). The PCI scope docs and the new operating-effectiveness
 *      policies (pen test, DR, monitoring, vuln mgmt) must exist.
 *   3. COLLECTORS (run, report mode). Every collector is invoked. A hard FAIL
 *      (e.g. a PAN leak) fails the build; SKIP/WARN are non-fatal (run --strict
 *      in CI to enforce), matching the S31 contract.
 *
 * Exit 1 on any coverage gap, missing corpus file, or collector FAIL.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type CollectorResult, type Status, fileURLToPath, printResult } from './_util';
import { run as runChangeMgmt } from './change-management';
import { run as runDepScan } from './dependency-scan';
import { run as runDrDrill } from './dr-drill';
import { run as runIncidents } from './incident-metrics';
import { run as runAdmins } from './list-admins';
import { run as runUsers } from './list-users-roles';
import { run as runMonitoring } from './monitoring-sample';
import { run as runAccessReview } from './quarterly-access-review';
import { run as runBackup } from './verify-backup';
import { run as runBranch } from './verify-branch-protection';
import { run as runNoPan } from './verify-no-pan-logs';
import { run as runStripeOnly } from './verify-stripe-only';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(REPO_ROOT, 'scripts', 'compliance');
const COMPLIANCE = join(REPO_ROOT, 'compliance');

interface CoverageRow {
  area: string;
  collector: string;
  run: (argv: string[]) => Promise<CollectorResult>;
}

const tmp = mkdtempSync(join(tmpdir(), 'compliance-type2-'));

/** Each Type II / PCI control area mapped to the collector that evidences it. */
const COVERAGE: CoverageRow[] = [
  {
    area: 'Access roster (CC6.1)',
    collector: 'list-users-roles',
    run: () => runUsers(['--out', join(tmp, 'u.csv')]),
  },
  {
    area: 'Privileged accounts (CC6.1)',
    collector: 'list-admins',
    run: () => runAdmins(['--out', join(tmp, 'a.csv')]),
  },
  {
    area: 'Quarterly access review (CC6.2)',
    collector: 'quarterly-access-review',
    run: () => runAccessReview(['--out', join(tmp, 'ar.md')]),
  },
  {
    area: 'Change management (CC8.1)',
    collector: 'change-management',
    run: (a) => runChangeMgmt(a),
  },
  { area: 'Incident response (CC7.3)', collector: 'incident-metrics', run: (a) => runIncidents(a) },
  { area: 'Backup / availability (A1.2)', collector: 'verify-backup', run: (a) => runBackup(a) },
  {
    area: 'Branch protection (CC8.1)',
    collector: 'verify-branch-protection',
    run: (a) => runBranch(a),
  },
  { area: 'Vulnerability mgmt (CC7.1)', collector: 'dependency-scan', run: (a) => runDepScan(a) },
  { area: 'Monitoring (CC4.1)', collector: 'monitoring-sample', run: (a) => runMonitoring(a) },
  {
    area: 'DR drill (A1.3)',
    collector: 'dr-drill',
    run: () => runDrDrill(['--out', join(tmp, 'dr.md')]),
  },
  { area: 'PCI no PAN (Req 3/10)', collector: 'verify-no-pan-logs', run: (a) => runNoPan(a) },
  {
    area: 'PCI Stripe-only (Req 3)',
    collector: 'verify-stripe-only',
    run: (a) => runStripeOnly(a),
  },
];

const REQUIRED_PCI_DOCS = ['scope.md', 'controls.md', 'network-diagram.md', 'asar.md'];
const REQUIRED_POLICIES = [
  'penetration-testing.md',
  'disaster-recovery.md',
  'monitoring.md',
  'vulnerability-management.md',
];

function structural(): CollectorResult[] {
  const out: CollectorResult[] = [];
  const ok = (message: string): CollectorResult => ({ status: 'ok', message });
  const fail = (message: string): CollectorResult => ({ status: 'fail', message });

  for (const row of COVERAGE) {
    const path = join(SCRIPTS, `${row.collector}.ts`);
    out.push(
      existsSync(path)
        ? ok(`coverage: ${row.area} → ${row.collector}.ts`)
        : fail(`MISSING collector for ${row.area}: ${row.collector}.ts`),
    );
  }
  for (const doc of REQUIRED_PCI_DOCS) {
    out.push(
      existsSync(join(COMPLIANCE, 'pci', doc))
        ? ok(`pci/${doc} present`)
        : fail(`missing compliance/pci/${doc}`),
    );
  }
  for (const p of REQUIRED_POLICIES) {
    out.push(
      existsSync(join(COMPLIANCE, 'policies', p))
        ? ok(`policy ${p} present`)
        : fail(`missing compliance/policies/${p}`),
    );
  }
  return out;
}

async function main(): Promise<void> {
  // biome-ignore lint/suspicious/noConsoleLog: CLI reporter
  console.log('\n=== SOC 2 Type II + PCI compliance:type2-check ===\n');

  // biome-ignore lint/suspicious/noConsoleLog: section header
  console.log('-- coverage matrix + corpus --');
  const structResults = structural();
  for (const r of structResults) printResult('structural', r);

  // biome-ignore lint/suspicious/noConsoleLog: section header
  console.log('\n-- collectors (report mode) --');
  const collectorResults: CollectorResult[] = [];
  for (const row of COVERAGE) {
    let result: CollectorResult;
    try {
      result = await row.run([]);
    } catch (err) {
      result = { status: 'fail', message: `collector threw: ${String(err)}` };
    }
    printResult(row.collector, result);
    collectorResults.push(result);
  }

  const all = [...structResults, ...collectorResults];
  const counts = all.reduce<Record<Status, number>>(
    (acc, r) => {
      acc[r.status] += 1;
      return acc;
    },
    { ok: 0, warn: 0, skip: 0, fail: 0 },
  );
  // biome-ignore lint/suspicious/noConsoleLog: summary line
  console.log(
    `\n=== summary: ${counts.ok} ok, ${counts.warn} warn, ${counts.skip} skip, ${counts.fail} fail ===`,
  );

  if (counts.fail > 0) {
    console.error('\ncompliance:type2-check FAILED — see ❌ entries above.');
    process.exit(1);
  }
  // biome-ignore lint/suspicious/noConsoleLog: success line
  console.log('compliance:type2-check passed (warn/skip non-fatal; use --strict in CI).\n');
}

main().catch((err: unknown) => {
  console.error('compliance:type2-check crashed:', err);
  process.exit(1);
});
