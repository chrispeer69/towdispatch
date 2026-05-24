# Evidence Collection

How each control's evidence is gathered, where it lives, and how to reproduce it
for the auditor. Evidence is either **continuous** (a system that always runs),
**scripted** (a collector under `scripts/compliance/`), or **manual** (a
document/screenshot captured on a cadence).

## Run the automated smoke test

```bash
pnpm compliance:check
```

This runs two layers:

1. **Structural** — asserts every control in `compliance/controls/` is listed in
   `matrix.md`, and every required policy exists. Fails the build (exit 1) if a
   control or policy is missing. This is the "evidence is missing" gate.
2. **Collectors** — runs each script below in *report mode*. A hard failure
   (broken control) fails the build; `WARN` (reachable but unmet) and `SKIP`
   (missing credential / external system) are reported but non-fatal. Run a
   collector with `--strict` to make `WARN → FAIL` for CI enforcement.

Exit-code convention per collector: `0` ok/warn, `3` skip, `1` fail.

## Collectors

| Script | Control | Produces | Requires |
|---|---|---|---|
| `scripts/compliance/list-users-roles.ts` | CC6 access control | CSV of all users: tenant, role, active, MFA, last login | `DATABASE_ADMIN_URL` |
| `scripts/compliance/list-admins.ts` | CC6 least privilege | CSV of OWNER/ADMIN accounts + MFA flag | `DATABASE_ADMIN_URL` |
| `scripts/compliance/verify-branch-protection.ts` | CC8 change mgmt | Asserts `master` requires PR + ≥1 review | authenticated `gh` CLI |
| `scripts/compliance/verify-backup.ts` | A1 availability | Asserts last DB backup < 24h old | `BACKUP_STATUS_URL` or `RAILWAY_API_TOKEN`+`RAILWAY_PROJECT_ID` |

Generated CSVs are written to `compliance/evidence/generated/` (git-ignored —
they contain user PII and are handed to the auditor out-of-band).

> The roster collectors use `DATABASE_ADMIN_URL` (the `app_admin` role) **on
> purpose**: a cross-tenant roster requires bypassing RLS, which only the admin
> role can do. They refuse to fall back to the app role, which RLS would render
> a misleadingly empty list. Running them against the live DB is itself captured
> in `audit_log` if it mutates anything (these are read-only).

## Continuous evidence (no script — point the auditor here)

| Evidence | Where | Control |
|---|---|---|
| Audit trail of every write | `audit_log` table; `GET /admin/audit-log`; `/admin/audit-log` UI | CC7.2 |
| Authentication & MFA enforcement | `apps/api/src/modules/auth/` | CC6.1 |
| Tenant isolation (RLS) | `apps/api/test/integration/rls.spec.ts` in CI | CC6.1 |
| Error monitoring | Sentry project (`SENTRY_DSN`) | CC4.1, CC7.3 |
| Metrics & latency | `/metrics` (prom-client), slow-query WARN logs | CC4.1, A1.1 |
| CI gates on every PR | `.github/workflows/e2e.yml` | CC8.1 |

## Manual evidence (capture on cadence — see matrix.md)

- Org chart and code-of-conduct acknowledgements (CC1).
- Annual risk assessment + risk register (CC3).
- Quarterly access review: export `list-users-roles.ts`, have the CTO sign off
  that each role assignment is still justified (CC6.2, CC6.3).
- Annual restore drill: restore the latest backup to a scratch environment,
  record RTO achieved, file in this directory (A1.3) — see
  [policies/bcdr.md](../policies/bcdr.md).
- Vendor SOC 2 reports collected annually (CC9.2) — see [vendors.md](../vendors.md).
