/**
 * Shared helpers for the SOC 2 evidence collectors (Session 31).
 *
 * Each collector returns a CollectorResult; the runner (check.ts) aggregates
 * them. Exit-code convention for standalone runs:
 *   ok   -> 0   control evidence present / assertion held
 *   warn -> 0   reachable but the control is not yet met (visible, non-fatal)
 *   skip -> 3   could not check — missing credential/env (documented, non-fatal)
 *   fail -> 1   evidence genuinely missing or the assertion definitively failed
 *
 * Rationale for warn/skip being non-fatal: per the repo operating rules, a
 * missing credential or unreachable external system is a documented skip, not a
 * build failure. `--strict` flips warn into fail for CI/auditor enforcement.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Status = 'ok' | 'warn' | 'skip' | 'fail';

export interface CollectorResult {
  status: Status;
  message: string;
  details?: string[];
}

export function exitCodeFor(status: Status): number {
  switch (status) {
    case 'ok':
    case 'warn':
      return 0;
    case 'skip':
      return 3;
    case 'fail':
      return 1;
  }
}

const ICON: Record<Status, string> = {
  ok: '✅ OK  ',
  warn: '⚠️  WARN',
  skip: '⏭️  SKIP',
  fail: '❌ FAIL',
};

export function printResult(name: string, result: CollectorResult): void {
  // biome-ignore lint/suspicious/noConsoleLog: evidence collectors are CLI tools
  console.log(`${ICON[result.status]}  ${name} — ${result.message}`);
  for (const d of result.details ?? []) {
    // biome-ignore lint/suspicious/noConsoleLog: evidence collectors are CLI tools
    console.log(`        ${d}`);
  }
}

/** owner/repo slug from the origin remote, or null if it can't be determined. */
export function getRepoSlug(): string | null {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** True when this module file is being executed directly (not imported). */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

export { fileURLToPath };
