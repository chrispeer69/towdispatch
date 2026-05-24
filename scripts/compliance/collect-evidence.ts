/**
 * `pnpm compliance:collect` — SOC 2 Type II continuous evidence collection
 * (Session 40). Run daily (04:00 UTC) by .github/workflows/compliance-evidence.yml.
 *
 * Invokes every continuous evidence collector in report mode and writes a dated
 * evidence set under compliance/evidence/automated/<YYYY-MM-DD>/:
 *   - <collector>.json     — the control-tagged EvidenceItem (status + metadata),
 *   - manifest.json        — the index an auditor pulls first.
 *
 * The JSON evidence carries no PII and is committed by the workflow, so the git
 * history is the 18-month retention store (see SESSION_40_DECISIONS.md D4/D5).
 * The PII-bearing roster CSVs (users-roles, admins) are written to the
 * git-ignored compliance/evidence/generated/ dir and handed to the auditor
 * out-of-band — they are NEVER committed.
 *
 * Exit code: 1 if any collector reported a hard FAIL (a definitively broken
 * control — e.g. a PAN leak); SKIP/WARN are non-fatal, matching the S31
 * collector contract. The quarterly collectors (quarterly-access-review,
 * dr-drill) run on their own cadence and are exercised by compliance:type2-check.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type CollectorResult, fileURLToPath, isMain, printResult } from './_util';
import { run as runChangeMgmt } from './change-management';
import { run as runDepScan } from './dependency-scan';
import {
  type EvidenceItem,
  buildManifest,
  evidenceDir,
  toEvidence,
  writeEvidenceItem,
  writeManifest,
} from './evidence';
import { run as runIncidents } from './incident-metrics';
import { run as runAdmins } from './list-admins';
import { run as runUsers } from './list-users-roles';
import { run as runMonitoring } from './monitoring-sample';
import { run as runBackup } from './verify-backup';
import { run as runBranch } from './verify-branch-protection';
import { run as runNoPan } from './verify-no-pan-logs';
import { run as runStripeOnly } from './verify-stripe-only';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WINDOW = 'type-ii-12mo';

export interface CollectorSpec {
  id: string;
  control: string;
  run: (argv: string[]) => Promise<CollectorResult>;
}

/**
 * Continuous (daily-meaningful) collectors. Quarterly ones run on their own
 * cadence. The PII-bearing roster CSVs go to the git-ignored `generated/` dir
 * (NOT the committed `dir`); only their no-PII status JSON lands in `dir`.
 */
function specs(dir: string): CollectorSpec[] {
  const genDir = join(dir, '..', '..', 'generated');
  mkdirSync(genDir, { recursive: true });
  return [
    {
      id: 'list-users-roles',
      control: 'CC6.1',
      run: () => runUsers(['--out', join(genDir, 'users-roles.csv')]),
    },
    {
      id: 'list-admins',
      control: 'CC6.1',
      run: () => runAdmins(['--out', join(genDir, 'admins.csv')]),
    },
    { id: 'verify-backup', control: 'A1.2', run: (a) => runBackup(a) },
    { id: 'verify-branch-protection', control: 'CC8.1', run: (a) => runBranch(a) },
    { id: 'change-management', control: 'CC8.1', run: (a) => runChangeMgmt(a) },
    { id: 'incident-metrics', control: 'CC7.3', run: (a) => runIncidents(a) },
    { id: 'monitoring-sample', control: 'CC4.1', run: (a) => runMonitoring(a) },
    { id: 'dependency-scan', control: 'CC7.1', run: (a) => runDepScan(a) },
    { id: 'verify-no-pan-logs', control: 'PCI-3/10', run: (a) => runNoPan(a) },
    { id: 'verify-stripe-only', control: 'PCI-3', run: (a) => runStripeOnly(a) },
  ];
}

/**
 * Run a given list of collectors, write each item + the manifest into `dir`,
 * return the items. The collector list is a parameter so tests can drive the
 * pipeline deterministically without touching the network.
 */
export async function collectFrom(
  dir: string,
  specList: CollectorSpec[],
  argv: string[] = [],
): Promise<EvidenceItem[]> {
  const items: EvidenceItem[] = [];
  for (const spec of specList) {
    let result: CollectorResult;
    try {
      result = await spec.run(argv);
    } catch (err) {
      result = { status: 'fail', message: `collector threw: ${String(err)}` };
    }
    const item = toEvidence(spec.id, spec.control, result);
    writeEvidenceItem(dir, item);
    printResult(spec.id, result);
    items.push(item);
  }
  writeManifest(dir, buildManifest(items, WINDOW));
  return items;
}

/** Run the full continuous collector set, writing evidence + manifest into `dir`. */
export async function collect(dir: string, argv: string[] = []): Promise<EvidenceItem[]> {
  return collectFrom(dir, specs(dir), argv);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dateIdx = argv.indexOf('--date');
  const date =
    dateIdx !== -1 && argv[dateIdx + 1]
      ? (argv[dateIdx + 1] as string)
      : new Date().toISOString().slice(0, 10);
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx !== -1 && argv[rootIdx + 1] ? (argv[rootIdx + 1] as string) : REPO_ROOT;

  const dir = evidenceDir(root, date);
  // biome-ignore lint/suspicious/noConsoleLog: CLI reporter
  console.log(`\n=== compliance:collect → ${dir} ===\n`);

  // Forward --strict to collectors but strip our own flags.
  const collectorArgv = argv.includes('--strict') ? ['--strict'] : [];
  const items = await collect(dir, collectorArgv);

  const fails = items.filter((i) => i.status === 'fail');
  const counts = buildManifest(items, WINDOW).summary;
  // biome-ignore lint/suspicious/noConsoleLog: summary line
  console.log(
    `\n=== ${items.length} collectors: ${counts.ok} ok, ${counts.warn} warn, ${counts.skip} skip, ${counts.fail} fail → ${dir}/manifest.json ===`,
  );
  if (fails.length > 0) {
    console.error(`\ncompliance:collect FAILED — ${fails.length} hard control failure(s).`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error('compliance:collect crashed:', err);
    process.exit(1);
  });
}
