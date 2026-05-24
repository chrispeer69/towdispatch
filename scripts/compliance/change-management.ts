/**
 * SOC 2 Type II evidence — change-management operating effectiveness (CC8.1).
 *
 * Type I asserted branch protection *exists* (verify-branch-protection.ts). Type
 * II must show change management *operated* over the window: that merged changes
 * were reviewed, that they shipped at a healthy cadence, and that rollbacks are
 * rare and visible. We compute three metrics over the trailing window from the
 * merged-PR history:
 *   - % of merged PRs that were approved (review coverage),
 *   - mean time-to-merge (cadence),
 *   - rollback rate (share of merges that are "Revert ..." PRs).
 *
 * Source: the GitHub API via the authenticated `gh` CLI. SKIPs cleanly when gh
 * is unavailable / unauthenticated (documented, non-fatal). Report mode warns
 * when review coverage is below target; --strict fails (CI/auditor enforcement).
 *
 * The metric math is pure (analyzeChangeManagement) so it unit-tests without gh.
 *
 * Usage:
 *   tsx scripts/compliance/change-management.ts [--days 90] [--strict]
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

/** Minimum acceptable share of merged PRs that were approved. */
export const REVIEW_COVERAGE_TARGET = 0.9;

export interface MergedPr {
  number: number;
  title: string;
  createdAt: string;
  mergedAt: string | null;
  /** GitHub reviewDecision: APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED / null. */
  reviewDecision: string | null;
}

export interface ChangeManagementMetrics {
  windowDays: number;
  mergedCount: number;
  approvedCount: number;
  reviewCoverage: number;
  meanTimeToMergeHours: number | null;
  rollbackCount: number;
  rollbackRate: number;
}

/** True when a merged PR is a revert (our rollback proxy). */
export function isRevert(title: string): boolean {
  return /^revert[\s:"']/i.test(title.trim());
}

export function analyzeChangeManagement(
  prs: MergedPr[],
  windowDays: number,
  strict: boolean,
): { result: CollectorResult; metrics: ChangeManagementMetrics } {
  const merged = prs.filter((p) => p.mergedAt !== null);
  const approved = merged.filter((p) => p.reviewDecision === 'APPROVED');
  const reverts = merged.filter((p) => isRevert(p.title));

  const durationsH = merged
    .map((p) => {
      const start = Date.parse(p.createdAt);
      const end = p.mergedAt ? Date.parse(p.mergedAt) : Number.NaN;
      return Number.isNaN(start) || Number.isNaN(end) ? null : (end - start) / 3_600_000;
    })
    .filter((h): h is number => h !== null && h >= 0);

  const reviewCoverage = merged.length === 0 ? 1 : approved.length / merged.length;
  const meanTimeToMergeHours =
    durationsH.length === 0
      ? null
      : Number((durationsH.reduce((a, b) => a + b, 0) / durationsH.length).toFixed(1));
  const rollbackRate = merged.length === 0 ? 0 : reverts.length / merged.length;

  const metrics: ChangeManagementMetrics = {
    windowDays,
    mergedCount: merged.length,
    approvedCount: approved.length,
    reviewCoverage: Number(reviewCoverage.toFixed(3)),
    meanTimeToMergeHours,
    rollbackCount: reverts.length,
    rollbackRate: Number(rollbackRate.toFixed(3)),
  };

  const details = [
    `merged PRs (last ${windowDays}d): ${merged.length}`,
    `approved: ${approved.length} (${(reviewCoverage * 100).toFixed(0)}% review coverage, target ${(REVIEW_COVERAGE_TARGET * 100).toFixed(0)}%)`,
    `mean time-to-merge: ${meanTimeToMergeHours === null ? 'n/a' : `${meanTimeToMergeHours}h`}`,
    `rollbacks (reverts): ${reverts.length} (${(rollbackRate * 100).toFixed(0)}%)`,
  ];

  if (merged.length === 0) {
    return {
      result: { status: 'warn', message: `no merged PRs in the last ${windowDays}d`, details },
      metrics,
    };
  }
  if (reviewCoverage < REVIEW_COVERAGE_TARGET) {
    const status: Status = strict ? 'fail' : 'warn';
    return {
      result: {
        status,
        message: `review coverage ${(reviewCoverage * 100).toFixed(0)}% below ${(REVIEW_COVERAGE_TARGET * 100).toFixed(0)}% target`,
        details,
      },
      metrics,
    };
  }
  return {
    result: {
      status: 'ok',
      message: `${merged.length} PRs merged, ${(reviewCoverage * 100).toFixed(0)}% approved`,
      details,
    },
    metrics,
  };
}

function fetchMergedPrs(slug: string, windowDays: number): MergedPr[] | null {
  try {
    const raw = execFileSync(
      'gh',
      [
        'pr',
        'list',
        '-R',
        slug,
        '--state',
        'merged',
        '--limit',
        '200',
        '--json',
        'number,title,createdAt,mergedAt,reviewDecision',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const all = JSON.parse(raw) as MergedPr[];
    const cutoff = Date.now() - windowDays * 86_400_000;
    return all.filter((p) => p.mergedAt !== null && Date.parse(p.mergedAt) >= cutoff);
  } catch {
    return null;
  }
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const strict = argv.includes('--strict');
  const daysIdx = argv.indexOf('--days');
  const windowDays = daysIdx !== -1 && argv[daysIdx + 1] ? Number(argv[daysIdx + 1]) : 90;

  const slug = getRepoSlug();
  if (!slug) {
    return {
      status: 'skip',
      message: 'no origin remote / GITHUB_REPOSITORY — cannot resolve repo',
    };
  }
  const prs = fetchMergedPrs(slug, windowDays);
  if (prs === null) {
    return {
      status: 'skip',
      message: 'gh CLI unavailable or unauthenticated — cannot read PR history',
    };
  }
  return analyzeChangeManagement(prs, windowDays, strict).result;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('change-management', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('change-management', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
