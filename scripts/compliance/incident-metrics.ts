/**
 * SOC 2 Type II evidence — incident-response operating effectiveness (CC7.3, CC7.4).
 *
 * Type II must show the incident-response control *operated*: that incidents are
 * tracked, resolved within a reasonable time, and followed by a post-mortem. We
 * read incidents from GitHub issues labelled `incident` and compute:
 *   - incident count over the window,
 *   - MTTR (mean time-to-resolve = closed_at - created_at, for closed incidents),
 *   - post-mortem completion rate (share of resolved incidents carrying a
 *     `post-mortem` label).
 *
 * Issues are the deliberate system of record for incidents (cheap, auditable,
 * already access-controlled) until a dedicated incident tool is adopted — see
 * compliance/policies/incident-response.md.
 *
 * Source: `gh` CLI. SKIPs when gh is unavailable. Metric math is pure
 * (analyzeIncidents) so it unit-tests without gh.
 *
 * Usage:
 *   tsx scripts/compliance/incident-metrics.ts [--days 365] [--strict]
 */
import { execFileSync } from 'node:child_process';
import {
  type CollectorResult,
  type Status,
  exitCodeFor,
  getRepoSlug,
  isMain,
  printResult,
} from './_util';

/** Minimum acceptable post-mortem completion rate for resolved incidents. */
export const POSTMORTEM_TARGET = 0.8;

export interface IncidentIssue {
  number: number;
  title: string;
  createdAt: string;
  closedAt: string | null;
  labels: string[];
}

export interface IncidentMetrics {
  windowDays: number;
  total: number;
  open: number;
  resolved: number;
  mttrHours: number | null;
  postMortemCount: number;
  postMortemRate: number;
}

export function hasPostMortem(labels: string[]): boolean {
  return labels.some((l) => /post[\s_-]?mortem/i.test(l));
}

export function analyzeIncidents(
  issues: IncidentIssue[],
  windowDays: number,
  strict: boolean,
): { result: CollectorResult; metrics: IncidentMetrics } {
  const resolved = issues.filter((i) => i.closedAt !== null);
  const open = issues.filter((i) => i.closedAt === null);

  const mttrsH = resolved
    .map((i) => {
      const start = Date.parse(i.createdAt);
      const end = i.closedAt ? Date.parse(i.closedAt) : Number.NaN;
      return Number.isNaN(start) || Number.isNaN(end) ? null : (end - start) / 3_600_000;
    })
    .filter((h): h is number => h !== null && h >= 0);

  const postMortems = resolved.filter((i) => hasPostMortem(i.labels));
  const postMortemRate = resolved.length === 0 ? 1 : postMortems.length / resolved.length;
  const mttrHours =
    mttrsH.length === 0
      ? null
      : Number((mttrsH.reduce((a, b) => a + b, 0) / mttrsH.length).toFixed(1));

  const metrics: IncidentMetrics = {
    windowDays,
    total: issues.length,
    open: open.length,
    resolved: resolved.length,
    mttrHours,
    postMortemCount: postMortems.length,
    postMortemRate: Number(postMortemRate.toFixed(3)),
  };

  const details = [
    `incidents (last ${windowDays}d): ${issues.length} (${open.length} open, ${resolved.length} resolved)`,
    `MTTR: ${mttrHours === null ? 'n/a' : `${mttrHours}h`}`,
    `post-mortem completion: ${postMortems.length}/${resolved.length} (${(postMortemRate * 100).toFixed(0)}%, target ${(POSTMORTEM_TARGET * 100).toFixed(0)}%)`,
  ];

  if (issues.length === 0) {
    // No incidents in the window is a healthy state, not a control gap.
    return {
      result: {
        status: 'ok',
        message: `no incidents recorded in the last ${windowDays}d`,
        details,
      },
      metrics,
    };
  }
  if (resolved.length > 0 && postMortemRate < POSTMORTEM_TARGET) {
    const status: Status = strict ? 'fail' : 'warn';
    return {
      result: {
        status,
        message: `post-mortem completion ${(postMortemRate * 100).toFixed(0)}% below ${(POSTMORTEM_TARGET * 100).toFixed(0)}% target`,
        details,
      },
      metrics,
    };
  }
  return {
    result: {
      status: 'ok',
      message: `${issues.length} incidents tracked, ${(postMortemRate * 100).toFixed(0)}% post-mortem rate`,
      details,
    },
    metrics,
  };
}

function fetchIncidents(slug: string, windowDays: number): IncidentIssue[] | null {
  try {
    const raw = execFileSync(
      'gh',
      [
        'issue',
        'list',
        '-R',
        slug,
        '--label',
        'incident',
        '--state',
        'all',
        '--limit',
        '500',
        '--json',
        'number,title,createdAt,closedAt,labels',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const all = JSON.parse(raw) as {
      number: number;
      title: string;
      createdAt: string;
      closedAt: string | null;
      labels: { name: string }[];
    }[];
    const cutoff = Date.now() - windowDays * 86_400_000;
    return all
      .filter((i) => Date.parse(i.createdAt) >= cutoff)
      .map((i) => ({
        number: i.number,
        title: i.title,
        createdAt: i.createdAt,
        closedAt: i.closedAt,
        labels: i.labels.map((l) => l.name),
      }));
  } catch {
    return null;
  }
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const strict = argv.includes('--strict');
  const daysIdx = argv.indexOf('--days');
  const windowDays = daysIdx !== -1 && argv[daysIdx + 1] ? Number(argv[daysIdx + 1]) : 365;

  const slug = getRepoSlug();
  if (!slug) {
    return {
      status: 'skip',
      message: 'no origin remote / GITHUB_REPOSITORY — cannot resolve repo',
    };
  }
  const issues = fetchIncidents(slug, windowDays);
  if (issues === null) {
    return {
      status: 'skip',
      message: 'gh CLI unavailable or unauthenticated — cannot read incident issues',
    };
  }
  return analyzeIncidents(issues, windowDays, strict).result;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('incident-metrics', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('incident-metrics', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
