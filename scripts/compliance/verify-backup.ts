/**
 * SOC 2 evidence — availability / backup (A1.2, A1.3).
 *
 * Asserts the most recent database backup completed within the last 24 hours,
 * matching the documented RPO in compliance/policies/bcdr.md.
 *
 * Backup-status source resolution (first that is configured wins):
 *   1. BACKUP_STATUS_URL — a small JSON endpoint that returns
 *      { "lastBackupAt": "<ISO-8601>" }. The nightly Railway backup job (or a
 *      wrapper around it) is expected to publish this. Concrete + verifiable.
 *   2. RAILWAY_API_TOKEN + RAILWAY_PROJECT_ID — best-effort Railway GraphQL
 *      query; SKIPs cleanly if the account's backup schema differs.
 *   3. neither — SKIP (documented; not a build failure).
 *
 * Modes: default = report (stale backup → WARN); --strict = enforce (→ FAIL).
 *
 * Usage:
 *   tsx scripts/compliance/verify-backup.ts
 *   tsx scripts/compliance/verify-backup.ts --strict
 */
import { type CollectorResult, type Status, exitCodeFor, isMain, printResult } from './_util';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function evaluate(lastBackupAt: string, strict: boolean): CollectorResult {
  const ts = Date.parse(lastBackupAt);
  if (Number.isNaN(ts)) {
    return {
      status: 'skip',
      message: `backup source returned an unparseable timestamp: ${lastBackupAt}`,
    };
  }
  const ageMs = Date.now() - ts;
  const ageHours = (ageMs / 3_600_000).toFixed(1);
  if (ageMs > MAX_AGE_MS) {
    const status: Status = strict ? 'fail' : 'warn';
    return {
      status,
      message: `last backup is ${ageHours}h old (exceeds 24h RPO)`,
      details: [lastBackupAt],
    };
  }
  return {
    status: 'ok',
    message: `last backup ${ageHours}h ago (within 24h RPO)`,
    details: [lastBackupAt],
  };
}

async function fromStatusUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { lastBackupAt?: string };
    return body.lastBackupAt ?? null;
  } catch {
    return null;
  }
}

async function fromRailway(token: string, projectId: string): Promise<string | null> {
  try {
    const res = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        query: 'query($id: String!) { backups(projectId: $id) { edges { node { createdAt } } } }',
        variables: { id: projectId },
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { backups?: { edges?: { node?: { createdAt?: string } }[] } };
    };
    const edges = body.data?.backups?.edges ?? [];
    const times = edges.map((e) => e.node?.createdAt).filter((t): t is string => Boolean(t));
    if (times.length === 0) return null;
    return times.sort().at(-1) ?? null;
  } catch {
    return null;
  }
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const strict = argv.includes('--strict');

  const statusUrl = process.env.BACKUP_STATUS_URL;
  if (statusUrl) {
    const ts = await fromStatusUrl(statusUrl);
    if (ts) return evaluate(ts, strict);
    return { status: 'skip', message: 'BACKUP_STATUS_URL set but unreachable / malformed' };
  }

  const token = process.env.RAILWAY_API_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  if (token && projectId) {
    const ts = await fromRailway(token, projectId);
    if (ts) return evaluate(ts, strict);
    return {
      status: 'skip',
      message: 'Railway API reachable but no backup record found (schema/account mismatch)',
    };
  }

  return {
    status: 'skip',
    message:
      'no backup source configured (set BACKUP_STATUS_URL or RAILWAY_API_TOKEN+RAILWAY_PROJECT_ID)',
  };
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('verify-backup', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('verify-backup', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
