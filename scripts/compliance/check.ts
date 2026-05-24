/**
 * `pnpm compliance:check` — SOC 2 evidence smoke test (Session 31).
 *
 * Two layers:
 *
 *   1. STRUCTURAL (always runs, no infra). Asserts the compliance/ corpus is
 *      complete and self-consistent: every required control + policy file
 *      exists, and every control is referenced in matrix.md. This is the
 *      "fails if any control evidence is missing" gate — a control with no
 *      matrix row, or a missing policy, fails the build (exit 1).
 *
 *   2. COLLECTORS (run in report mode). Invokes each evidence collector. A
 *      collector that FAILs (a definitively broken control) fails the build.
 *      WARN (control reachable but not yet met) and SKIP (missing credential /
 *      external system) are reported but non-fatal, per the repo operating
 *      rules — run the collectors with --strict in CI to enforce.
 *
 * Live evidence (user/admin CSVs) is written to compliance/evidence/generated/
 * when a DB is reachable; that directory is git-ignored.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type CollectorResult, type Status, fileURLToPath, printResult } from './_util';
import { run as runAdmins } from './list-admins';
import { run as runUsers } from './list-users-roles';
import { run as runBackup } from './verify-backup';
import { run as runBranch } from './verify-branch-protection';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPLIANCE = join(REPO_ROOT, 'compliance');

const EXPECTED_POLICIES = [
  'security.md',
  'access-control.md',
  'change-management.md',
  'incident-response.md',
  'vendor-management.md',
  'data-classification.md',
  'bcdr.md',
  'acceptable-use.md',
];

const today = new Date().toISOString().slice(0, 10);

function structuralChecks(): CollectorResult[] {
  const results: CollectorResult[] = [];
  const pass = (message: string): CollectorResult => ({ status: 'ok', message });
  const fail = (message: string, details?: string[]): CollectorResult => ({
    status: 'fail',
    message,
    details,
  });

  // Required top-level artifacts.
  for (const rel of ['matrix.md', 'vendors.md', 'evidence/README.md']) {
    results.push(
      existsSync(join(COMPLIANCE, rel))
        ? pass(`compliance/${rel} present`)
        : fail(`missing compliance/${rel}`),
    );
  }

  // Policies.
  for (const p of EXPECTED_POLICIES) {
    results.push(
      existsSync(join(COMPLIANCE, 'policies', p))
        ? pass(`policy ${p} present`)
        : fail(`missing policy compliance/policies/${p}`),
    );
  }

  // Controls exist and are each referenced in matrix.md.
  const controlsDir = join(COMPLIANCE, 'controls');
  if (!existsSync(controlsDir)) {
    results.push(fail('missing compliance/controls/ directory'));
    return results;
  }
  const controls = readdirSync(controlsDir).filter((f) => f.endsWith('.md'));
  if (controls.length === 0) {
    results.push(fail('compliance/controls/ has no control files'));
  }
  const matrixPath = join(COMPLIANCE, 'matrix.md');
  const matrix = existsSync(matrixPath) ? readFileSync(matrixPath, 'utf8') : '';
  const unreferenced = controls.filter((c) => !matrix.includes(c));
  if (unreferenced.length > 0) {
    results.push(fail('control(s) not referenced in matrix.md', unreferenced));
  } else if (controls.length > 0) {
    results.push(pass(`all ${controls.length} controls referenced in matrix.md`));
  }

  return results;
}

async function main(): Promise<void> {
  // biome-ignore lint/suspicious/noConsoleLog: this is a CLI reporter
  console.log('\n=== SOC 2 compliance:check ===\n');

  // biome-ignore lint/suspicious/noConsoleLog: section header
  console.log('-- structural --');
  const structural = structuralChecks();
  for (const r of structural) printResult('structural', r);

  // biome-ignore lint/suspicious/noConsoleLog: section header
  console.log('\n-- evidence collectors --');
  const genDir = join(COMPLIANCE, 'evidence', 'generated');
  mkdirSync(genDir, { recursive: true });

  const collectorRuns: { name: string; result: CollectorResult }[] = [
    {
      name: 'list-users-roles',
      result: await runUsers(['--out', join(genDir, `users-roles-${today}.csv`)]),
    },
    {
      name: 'list-admins',
      result: await runAdmins(['--out', join(genDir, `admins-${today}.csv`)]),
    },
    { name: 'verify-branch-protection', result: await runBranch([]) },
    { name: 'verify-backup', result: await runBackup([]) },
  ];
  for (const { name, result } of collectorRuns) printResult(name, result);

  // Summary.
  const all: { status: Status }[] = [...structural, ...collectorRuns.map((c) => c.result)];
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
    console.error('\ncompliance:check FAILED — see ❌ entries above.');
    process.exit(1);
  }
  // biome-ignore lint/suspicious/noConsoleLog: success line
  console.log(
    'compliance:check passed (warn/skip are non-fatal; use --strict collectors in CI).\n',
  );
}

main().catch((err: unknown) => {
  console.error('compliance:check crashed:', err);
  process.exit(1);
});
