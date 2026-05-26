# Session 31 Report — SOC 2 Type I

## TL;DR

Stood up the SOC 2 Type I foundation: a complete `compliance/` corpus (12 control
docs across CC1–CC9 + A1, 8 policies, evidence README, control matrix, vendor
inventory), an admin/auditor-facing **audit-log query API + web viewer** with
**secret redaction**, four scripted **evidence collectors** behind
`pnpm compliance:check`, an audit-trigger **gap analysis + backfill migration**,
and an incident-response policy + GitHub issue template. All gates green:
typecheck, biome (0 errors), 312 API tests pass, build, and `compliance:check`.

Decision log: [SESSION_31_DECISIONS.md](SESSION_31_DECISIONS.md).

## What shipped ✅

- **Compliance corpus** (`compliance/`)
  - `controls/` — CC1–CC9 + A1, plus cross-cutting `audit-logging.md` and
    `access-control.md` (RBAC matrix). 12 files, each grounded in real code.
  - `policies/` — security, access-control, change-management, incident-response,
    vendor-management, data-classification, BCDR, acceptable-use.
  - `matrix.md` (control→evidence→owner), `vendors.md`, `evidence/README.md`.
- **Audit-log query API** — `GET /admin/audit-log`
  (`apps/api/src/modules/admin/`), `@Roles(OWNER, ADMIN, AUDITOR)`, tenant-scoped
  via RLS, filters (actor/table/action/date/resource), paginated. **Secret
  redaction** strips `*_hash` / `*secret*` / `*password*` fields from snapshots.
  Zod contract in `packages/shared/src/schemas/audit-log.ts`.
- **Web viewer** — `/admin/audit-log` (first `admin/` route): role-gated server
  component, native GET filter form (a11y, shareable URLs), pagination.
- **Audit-trigger backfill** — `packages/db/sql/0037_compliance_audit_backfill.sql`
  adds triggers to `invoice_taxes`, `job_ratings`, `tenant_default_rate_sheets`,
  `tracking_messages`. 66 tables were already covered; 6 are intentionally
  excluded with documented rationale.
- **Evidence collectors** (`scripts/compliance/`) + `pnpm compliance:check`:
  `list-users-roles.ts`, `list-admins.ts`, `verify-branch-protection.ts`,
  `verify-backup.ts`, and the `check.ts` runner (structural + collector layers).
- **Incident response** — `compliance/policies/incident-response.md` (severity,
  on-call placeholder, comms + post-mortem templates) and
  `.github/ISSUE_TEMPLATE/incident.md`.
- **Tests** — `audit-redaction.spec.ts` (7), `admin.spec.ts` (2, mocked DB:
  tenant-context wiring + redaction + controller mapping), `audit-trigger.spec.ts`
  (5, DB-gated: I/U/D firing + actor capture + backfill trigger presence).

## Deferred 🟡 (see decisions doc for full list)

- SOC 2 **Type II** (operating-effectiveness over a period) + **PCI DSS** → S40.
- Confidentiality / Processing Integrity / Privacy TSC → S40.
- `audit_log` hard-purge retention job (7-yr window currently met by default).
- Wire `--strict` collectors into CI; set `BACKUP_STATUS_URL` for continuous
  backup-recency assertion.
- **`master` branch protection is not configured** — `verify-branch-protection`
  reports this as WARN. Close it in GitHub → Settings → Branches.

## What was NOT touched

- **Auth flows** — unchanged (`sessions` deliberately excluded from the audit
  backfill to avoid touching the auth surface).
- **Payments / Stripe** — unchanged (PCI is S40; `stripe_events` excluded).
- No new feature code outside compliance scope.

## Test coverage

| Suite | Result |
|---|---|
| `pnpm typecheck` (6 workspaces) | ✅ pass |
| `pnpm biome check .` | ✅ 0 errors (23 pre-existing warnings, none from new files) |
| API unit tests (new) | ✅ 9 pass (redaction 7, admin 2) |
| API full suite | ✅ 312 pass, 415 skipped (DB-gated), 0 fail |
| `pnpm build` (web + api) | ✅ Done |
| `pnpm compliance:check` | ✅ 12 ok, 1 warn (branch protection), 3 skip, 0 fail |

DB-gated integration tests self-skip without `DATABASE_URL` (mirrors the existing
`*-rls.spec.ts` convention; only `e2e.yml` runs in CI).

## Known issues

- `master` lacks branch protection (surfaced by the change-management collector).
- Backup recency cannot be asserted until `BACKUP_STATUS_URL` /
  `RAILWAY_API_TOKEN` is configured (collector SKIPs cleanly meanwhile).

## Commands

```bash
pnpm compliance:check                      # structural + evidence smoke test
tsx scripts/compliance/list-users-roles.ts --out users.csv   # needs DATABASE_ADMIN_URL
tsx scripts/compliance/verify-branch-protection.ts --strict  # enforce in CI
pnpm --filter @ustowdispatch/api exec vitest run src/modules/admin
pnpm typecheck && pnpm biome check . && pnpm build
```
