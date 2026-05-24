/**
 * SOC 2 evidence — full user/role roster (CC6.1, CC6.2, CC6.3 access control).
 *
 * Emits a CSV of every user across every tenant: identity, role, active flag,
 * MFA status, and last-login timestamp. Feeds the quarterly access review.
 *
 * Connects with DATABASE_ADMIN_URL (app_admin) ON PURPOSE: gathering a
 * cross-tenant roster requires bypassing RLS, which only the admin role can do.
 * This is an ops-run evidence script, not an app code path — its use is itself
 * captured in audit_log when run against the live DB. If DATABASE_ADMIN_URL is
 * unset it SKIPs (it will NOT silently fall back to the app role, which RLS
 * would render an empty — and misleading — roster).
 *
 * Usage:
 *   tsx scripts/compliance/list-users-roles.ts            # CSV to stdout
 *   tsx scripts/compliance/list-users-roles.ts --out f.csv
 */
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { type CollectorResult, exitCodeFor, isMain, printResult } from './_util';

interface UserRow {
  tenant_id: string;
  tenant_name: string | null;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean;
  mfa_enabled: boolean;
  last_login_at: Date | null;
  deleted_at: Date | null;
}

const COLUMNS: (keyof UserRow)[] = [
  'tenant_id',
  'tenant_name',
  'user_id',
  'email',
  'first_name',
  'last_name',
  'role',
  'is_active',
  'mfa_enabled',
  'last_login_at',
  'deleted_at',
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: UserRow[]): string {
  const header = COLUMNS.join(',');
  const lines = rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','));
  return [header, ...lines].join('\n');
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    return {
      status: 'skip',
      message: 'DATABASE_ADMIN_URL not set — cannot gather cross-tenant user roster',
    };
  }

  const pool = new Pool({ connectionString: adminUrl, max: 2 });
  try {
    const { rows } = await pool.query<UserRow>(
      `SELECT u.tenant_id, t.name AS tenant_name, u.id AS user_id, u.email,
              u.first_name, u.last_name, u.role, u.is_active, u.mfa_enabled,
              u.last_login_at, u.deleted_at
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
        ORDER BY t.name NULLS LAST, u.role, u.email`,
    );
    const csv = toCsv(rows);
    const outIdx = argv.indexOf('--out');
    if (outIdx !== -1 && argv[outIdx + 1]) {
      writeFileSync(argv[outIdx + 1] as string, `${csv}\n`, 'utf8');
    } else {
      // biome-ignore lint/suspicious/noConsoleLog: CSV output to stdout is the point
      console.log(csv);
    }
    return { status: 'ok', message: `${rows.length} users across all tenants` };
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('list-users-roles', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('list-users-roles', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
