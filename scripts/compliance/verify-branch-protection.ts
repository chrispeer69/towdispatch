/**
 * SOC 2 evidence — change management (CC8.1).
 *
 * Asserts the default branch (master) is protected: pull request required, at
 * least one approving review, and stale-approval dismissal on. Uses the GitHub
 * API via the authenticated `gh` CLI.
 *
 * Modes:
 *   default  — report mode. A reachable-but-unprotected branch is WARN (visible,
 *              non-fatal) so `pnpm compliance:check` stays green while surfacing
 *              the gap. Inability to reach the API (no gh, not authenticated, no
 *              remote) is SKIP.
 *   --strict — CI/auditor enforcement. WARN becomes FAIL (exit 1).
 *
 * Usage:
 *   tsx scripts/compliance/verify-branch-protection.ts
 *   tsx scripts/compliance/verify-branch-protection.ts --strict
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

const BRANCH = 'master';

interface ProtectionResponse {
  required_pull_request_reviews?: {
    required_approving_review_count?: number;
    dismiss_stale_reviews?: boolean;
  };
  required_status_checks?: { contexts?: string[] } | null;
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const strict = argv.includes('--strict');
  const unmet = (status: Exclude<Status, 'ok' | 'skip'>): Status => (strict ? 'fail' : status);

  const slug = getRepoSlug();
  if (!slug) {
    return {
      status: 'skip',
      message: 'no origin remote / GITHUB_REPOSITORY — cannot resolve repo',
    };
  }

  let raw: string;
  try {
    raw = execFileSync('gh', ['api', `repos/${slug}/branches/${BRANCH}/protection`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString() ?? '';
    if (/not found/i.test(stderr) || /404/.test(stderr)) {
      return {
        status: unmet('warn'),
        message: `${BRANCH} has no branch-protection rule configured`,
        details: ['Configure: Settings → Branches → require PR + 1 approval before merging'],
      };
    }
    // gh missing, not authenticated, or network error — cannot verify.
    return {
      status: 'skip',
      message: 'gh CLI unavailable or unauthenticated — cannot verify branch protection',
    };
  }

  let data: ProtectionResponse;
  try {
    data = JSON.parse(raw) as ProtectionResponse;
  } catch {
    return { status: 'skip', message: 'unexpected gh API response (not JSON)' };
  }

  const reviews = data.required_pull_request_reviews;
  const approvals = reviews?.required_approving_review_count ?? 0;
  const hasChecks = (data.required_status_checks?.contexts?.length ?? 0) > 0;
  const details = [
    `required approving reviews: ${approvals}`,
    `dismiss stale reviews: ${reviews?.dismiss_stale_reviews ? 'yes' : 'no'}`,
    `required status checks: ${hasChecks ? 'yes' : 'none'}`,
  ];

  if (!reviews) {
    return {
      status: unmet('warn'),
      message: `${BRANCH} does not require pull-request reviews`,
      details,
    };
  }
  if (approvals < 1) {
    return {
      status: unmet('warn'),
      message: `${BRANCH} requires 0 approving reviews (expected ≥1)`,
      details,
    };
  }
  return { status: 'ok', message: `${BRANCH} requires PR + ${approvals} approval(s)`, details };
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('verify-branch-protection', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('verify-branch-protection', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
