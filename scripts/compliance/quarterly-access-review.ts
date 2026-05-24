/**
 * SOC 2 Type II evidence — quarterly access review (CC6.1, CC6.2, CC6.3).
 *
 * Type I asserted RBAC + least privilege are designed. Type II requires the
 * access review to actually *run* every quarter and produce a dated, reviewable
 * artifact. This collector pulls the cross-tenant roster and emits a markdown
 * report that flags:
 *   - stale users (active, not deleted, no login in > 90 days),
 *   - active users who have never logged in,
 *   - privileged accounts (owner/admin) without MFA enrolled,
 *   - the role distribution per tenant.
 *
 * The reviewer signs the emitted report; the signed report is the evidence.
 *
 * Connects via DATABASE_ADMIN_URL (app_admin) on purpose — a cross-tenant roster
 * needs to bypass RLS, same rationale as list-users-roles.ts. SKIPs if unset
 * (will NOT fall back to the app role, which RLS would render empty/misleading).
 *
 * analyzeRoster + renderReview are pure so they unit-test without a database.
 *
 * Usage:
 *   tsx scripts/compliance/quarterly-access-review.ts [--out report.md]
 */
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { type CollectorResult, exitCodeFor, isMain, printResult } from './_util';

export const STALE_LOGIN_DAYS = 90;
const PRIVILEGED_ROLES = new Set(['owner', 'admin']);

export interface RosterUser {
  tenantName: string | null;
  email: string;
  role: string;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  deletedAt: string | null;
}

export interface AccessReviewAnalysis {
  total: number;
  activeCount: number;
  staleUsers: RosterUser[];
  neverLoggedIn: RosterUser[];
  privilegedWithoutMfa: RosterUser[];
  roleDistribution: Record<string, number>;
}

export function analyzeRoster(users: RosterUser[], now: Date = new Date()): AccessReviewAnalysis {
  const staleCutoff = now.getTime() - STALE_LOGIN_DAYS * 86_400_000;
  const live = users.filter((u) => u.deletedAt === null);
  const active = live.filter((u) => u.isActive);

  const staleUsers = active.filter(
    (u) => u.lastLoginAt !== null && Date.parse(u.lastLoginAt) < staleCutoff,
  );
  const neverLoggedIn = active.filter((u) => u.lastLoginAt === null);
  const privilegedWithoutMfa = active.filter((u) => PRIVILEGED_ROLES.has(u.role) && !u.mfaEnabled);

  const roleDistribution = active.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  return {
    total: users.length,
    activeCount: active.length,
    staleUsers,
    neverLoggedIn,
    privilegedWithoutMfa,
    roleDistribution,
  };
}

/** Calendar quarter label for a date, e.g. "2026-Q2". */
export function quarterLabel(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

export function renderReview(analysis: AccessReviewAnalysis, now: Date = new Date()): string {
  const q = quarterLabel(now);
  const row = (u: RosterUser): string =>
    `| ${u.tenantName ?? '—'} | ${u.email} | ${u.role} | ${u.lastLoginAt ?? 'never'} |`;
  const roles = Object.entries(analysis.roleDistribution)
    .sort()
    .map(([r, n]) => `${r}: ${n}`)
    .join(', ');

  return `# Access Review — ${q}

> SOC 2 CC6.1–6.3 quarterly access review. Generated ${now.toISOString()}.
> Reviewer: ___________________  Sign-off date: ___________

## Summary

- Users (all): **${analysis.total}**
- Active (not deleted): **${analysis.activeCount}**
- Role distribution (active): ${roles || 'none'}
- Stale logins (> ${STALE_LOGIN_DAYS}d): **${analysis.staleUsers.length}**
- Never logged in (active): **${analysis.neverLoggedIn.length}**
- Privileged without MFA: **${analysis.privilegedWithoutMfa.length}**

## Stale accounts (review for deactivation)

| Tenant | Email | Role | Last login |
|---|---|---|---|
${analysis.staleUsers.map(row).join('\n') || '| _none_ | | | |'}

## Active, never logged in

| Tenant | Email | Role | Last login |
|---|---|---|---|
${analysis.neverLoggedIn.map(row).join('\n') || '| _none_ | | | |'}

## Privileged accounts without MFA (remediate)

| Tenant | Email | Role | Last login |
|---|---|---|---|
${analysis.privilegedWithoutMfa.map(row).join('\n') || '| _none_ | | | |'}

## Reviewer actions

- [ ] Confirmed every active account still requires its role.
- [ ] Deactivated stale / never-logged-in accounts that are no longer needed.
- [ ] Enforced MFA on every privileged account flagged above.
- [ ] Filed this signed report under compliance/evidence/ for the audit window.
`;
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    return {
      status: 'skip',
      message: 'DATABASE_ADMIN_URL not set — cannot gather cross-tenant roster for access review',
    };
  }

  const pool = new Pool({ connectionString: adminUrl, max: 2 });
  try {
    const { rows } = await pool.query<{
      tenant_name: string | null;
      email: string;
      role: string;
      is_active: boolean;
      mfa_enabled: boolean;
      last_login_at: Date | null;
      deleted_at: Date | null;
    }>(
      `SELECT t.name AS tenant_name, u.email, u.role, u.is_active, u.mfa_enabled,
              u.last_login_at, u.deleted_at
         FROM users u JOIN tenants t ON t.id = u.tenant_id
        ORDER BY t.name NULLS LAST, u.role, u.email`,
    );
    const users: RosterUser[] = rows.map((r) => ({
      tenantName: r.tenant_name,
      email: r.email,
      role: r.role,
      isActive: r.is_active,
      mfaEnabled: r.mfa_enabled,
      lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
      deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    }));

    const now = new Date();
    const analysis = analyzeRoster(users, now);
    const md = renderReview(analysis, now);
    const outIdx = argv.indexOf('--out');
    if (outIdx !== -1 && argv[outIdx + 1]) {
      writeFileSync(argv[outIdx + 1] as string, md, 'utf8');
    } else {
      // biome-ignore lint/suspicious/noConsoleLog: markdown report to stdout is the point
      console.log(md);
    }

    const flagged =
      analysis.staleUsers.length +
      analysis.neverLoggedIn.length +
      analysis.privilegedWithoutMfa.length;
    if (flagged > 0) {
      return {
        status: 'warn',
        message: `access review ${quarterLabel(now)}: ${flagged} account(s) need review`,
        details: [
          `stale: ${analysis.staleUsers.length}`,
          `never-logged-in: ${analysis.neverLoggedIn.length}`,
          `privileged w/o MFA: ${analysis.privilegedWithoutMfa.length}`,
        ],
      };
    }
    return {
      status: 'ok',
      message: `access review ${quarterLabel(now)}: ${analysis.activeCount} active accounts, no anomalies`,
    };
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('quarterly-access-review', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('quarterly-access-review', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
