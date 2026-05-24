/**
 * SOC 2 Type II / PCI evidence — vulnerability management (CC7.1; PCI Req 6.3.2, 11.3).
 *
 * Runs `pnpm audit --json` and scores the dependency tree against the documented
 * remediation SLA (compliance/policies/vulnerability-management.md):
 *   critical < 7 days, high < 30, medium < 90.
 *
 * The presence of an unremediated critical/high is the signal. In report mode a
 * critical/high is WARN (visible, non-fatal — the SLA clock, not the build, is
 * what enforces remediation). --strict fails the build when any critical/high is
 * present, which the weekly CI scan uses as a gate.
 *
 * pnpm audit exits non-zero when vulnerabilities exist, so we capture stdout
 * regardless of exit code. The scoring (analyzeAudit) is pure and unit-tests
 * against canned audit JSON.
 *
 * Usage:
 *   tsx scripts/compliance/dependency-scan.ts [--strict]
 */
import { execFileSync } from 'node:child_process';
import { type CollectorResult, type Status, exitCodeFor, isMain, printResult } from './_util';

export interface VulnCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
}

/** Shape of the `metadata.vulnerabilities` block pnpm/npm audit emits. */
interface AuditJson {
  metadata?: { vulnerabilities?: Partial<VulnCounts> };
  advisories?: Record<string, unknown>;
}

export function parseAuditCounts(json: unknown): VulnCounts {
  const v = (json as AuditJson)?.metadata?.vulnerabilities ?? {};
  return {
    critical: v.critical ?? 0,
    high: v.high ?? 0,
    moderate: v.moderate ?? 0,
    low: v.low ?? 0,
    info: v.info ?? 0,
  };
}

export function analyzeAudit(
  counts: VulnCounts,
  strict: boolean,
): { result: CollectorResult; data: VulnCounts } {
  const details = [
    `critical: ${counts.critical} (SLA: remediate < 7 days)`,
    `high: ${counts.high} (SLA: < 30 days)`,
    `moderate: ${counts.moderate} (SLA: < 90 days)`,
    `low: ${counts.low}`,
  ];
  const blocking = counts.critical + counts.high;
  if (blocking > 0) {
    const status: Status = strict ? 'fail' : 'warn';
    return {
      result: {
        status,
        message: `${counts.critical} critical, ${counts.high} high vulnerabilities require remediation`,
        details,
      },
      data: counts,
    };
  }
  if (counts.moderate > 0) {
    return {
      result: {
        status: 'warn',
        message: `${counts.moderate} moderate vulnerabilities (remediate < 90 days)`,
        details,
      },
      data: counts,
    };
  }
  return {
    result: { status: 'ok', message: 'no critical/high/moderate vulnerabilities', details },
    data: counts,
  };
}

/** Run `pnpm audit --json`, tolerating its non-zero exit on findings. */
function runPnpmAudit(): unknown | null {
  let stdout = '';
  try {
    stdout = execFileSync('pnpm', ['audit', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // Non-zero exit = vulnerabilities found; the JSON is still on stdout.
    stdout = (err as { stdout?: Buffer | string }).stdout?.toString() ?? '';
  }
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // pnpm may emit NDJSON in some versions; take the last complete JSON object.
    const lastBrace = trimmed.lastIndexOf('\n{');
    if (lastBrace !== -1) {
      try {
        return JSON.parse(trimmed.slice(lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const strict = argv.includes('--strict');
  const json = runPnpmAudit();
  if (json === null) {
    return {
      status: 'skip',
      message: 'pnpm audit produced no parseable output (offline / no registry)',
    };
  }
  return analyzeAudit(parseAuditCounts(json), strict).result;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('dependency-scan', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('dependency-scan', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
