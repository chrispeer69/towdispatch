/**
 * SOC 2 evidence — privileged-account inventory (CC6.1, CC6.3 least privilege).
 *
 * Emits a CSV of every OWNER and ADMIN account across all tenants — the
 * accounts that can change roles, deactivate users, and manage billing. This
 * is the list an auditor samples for the "are privileged accounts justified and
 * MFA-protected?" test. MFA status is included so a privileged account without
 * MFA is immediately visible.
 *
 * Like list-users-roles, connects with DATABASE_ADMIN_URL to read across
 * tenants; SKIPs if unset. See that file for the RLS rationale.
 *
 * Usage:
 *   tsx scripts/compliance/list-admins.ts
 *   tsx scripts/compliance/list-admins.ts --out admins.csv
 */
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { type CollectorResult, exitCodeFor, isMain, printResult } from './_util';

interface AdminRow {
  tenant_id: string;
  tenant_name: string | null;
  user_id: string;
  email: string;
  role: string;
  is_active: boolean;
  mfa_enabled: boolean;
  last_login_at: Date | null;
}

const COLUMNS: (keyof AdminRow)[] = [
  'tenant_id',
  'tenant_name',
  'user_id',
  'email',
  'role',
  'is_active',
  'mfa_enabled',
  'last_login_at',
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: AdminRow[]): string {
  const header = COLUMNS.join(',');
  const lines = rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','));
  return [header, ...lines].join('\n');
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    return {
      status: 'skip',
      message: 'DATABASE_ADMIN_URL not set — cannot gather privileged-account inventory',
    };
  }

  const pool = new Pool({ connectionString: adminUrl, max: 2 });
  try {
    const { rows } = await pool.query<AdminRow>(
      `SELECT u.tenant_id, t.name AS tenant_name, u.id AS user_id, u.email, u.role,
              u.is_active, u.mfa_enabled, u.last_login_at
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
        WHERE u.role IN ('owner', 'admin')
          AND u.deleted_at IS NULL
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
    const noMfa = rows.filter((r) => !r.mfa_enabled && r.is_active).length;
    const details = noMfa > 0 ? [`${noMfa} active privileged account(s) WITHOUT MFA`] : [];
    return {
      status: 'ok',
      message: `${rows.length} privileged (owner/admin) accounts`,
      details,
    };
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('list-admins', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('list-admins', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
