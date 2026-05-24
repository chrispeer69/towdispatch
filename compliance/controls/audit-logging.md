# Control: Audit Logging (CC7.2)

**Objective.** Every state-changing action on tenant data is captured in an
immutable, tamper-evident log, attributable to an actor, and retained long
enough to support investigation and the SOC 2 examination period.

## Design

Audit logging is **trigger-driven**, not application-driven, so "forgot to log
it" is structurally impossible:

- A single generic trigger function `fn_audit_log()`
  (`packages/db/sql/0004_audit_trigger.sql`) fires `AFTER INSERT OR UPDATE OR
  DELETE` on each audited table and writes one row to `audit_log`.
- It runs `SECURITY DEFINER` (as the table owner), so even direct ops changes
  via `app_admin` are audited — there is no privileged bypass.
- It is **fail-closed**: if it cannot resolve a `tenant_id` for the row it
  raises an exception rather than silently skipping the audit.
- Captured columns: `tenant_id`, `actor_id` (from `app.current_user_id`),
  `action`, `resource_type`, `resource_id`, `before_state`, `after_state`,
  `request_id`, `ip_address`, `user_agent`, `created_at`.
- `audit_log` is append-only by policy: the app role has no `UPDATE`/`DELETE`
  grant; the trigger writes via `SECURITY DEFINER`.

## Coverage (verified 2026-05-24, Session 31)

An audit of `packages/db/sql/` found **66** tenant tables already wired to
`fn_audit_log()`. Session 31 added triggers to four more
(`packages/db/sql/0037_compliance_audit_backfill.sql`):

| Table | Why added |
|---|---|
| `invoice_taxes` | Financial — tax lines on invoices |
| `job_ratings` | Business record — customer satisfaction ratings |
| `tenant_default_rate_sheets` | Config — default rate-sheet mapping |
| `tracking_messages` | Customer comms — mirrors `tracking_links` (already audited) |

### Deliberate exclusions

Six tables are intentionally **not** audited. The same rationale lives in the
migration header so the auditor sees one answer in two places:

| Table | Rationale |
|---|---|
| `driver_telemetry_events` | High-volume, append-only GPS stream. The row *is* the record; auditing doubles write volume with no integrity benefit. |
| `job_status_transitions` | Purpose-built, append-only state-change log — already an audit trail. Auditing its inserts duplicates the record. |
| `invoice_number_sequences`, `job_number_sequences` | Mechanical monotonic counters; the allocated number is captured on the audited `invoices`/`jobs` row. (Also allow-listed in `scripts/check-migrations.sh`.) |
| `sessions` | Auth surface — refresh-token rotation churns it every request, and auth already has dedicated security logging (login attempts, token-reuse → Sentry). Excluded to honor the Session 31 "do not modify auth flows" boundary; revisit S40. |
| `stripe_events` | Stripe/PCI surface (deferred to S40) and itself an append-only webhook idempotency ledger. |

`audit_log` itself is never audited (it would recurse and is append-only).

## Access to the audit trail (auditability without exposure)

`GET /admin/audit-log` (`apps/api/src/modules/admin/`) is the read surface:

- Restricted to `OWNER`, `ADMIN`, and `AUDITOR` (the read-only role we hand to
  an external auditor) via `@Roles` + `RolesGuard`.
- Runs inside the caller's tenant transaction, so **RLS confines results to the
  caller's own tenant**. There is no cross-tenant read path (that would need a
  platform-superadmin role we do not have).
- Filters: actor, resource type (table), resource id, action, date range;
  paginated, newest first.
- **Secret redaction (critical):** `before_state`/`after_state` are full row
  snapshots that can contain `password_hash`, `totp_secret_encrypted`,
  `mfa_recovery_codes`, `token_hash`, `pin_hash`, etc. The service redacts any
  field whose name ends in `_hash` or contains
  `secret`/`password`/`recovery_codes`/`backup_codes` before serialization
  (`apps/api/src/modules/admin/audit-redaction.ts`). Unit tests assert
  `password_hash` and the array-valued `mfa_recovery_codes` never appear in a
  response. Without this, the audit reader would leak the very secrets this
  control exists to protect.
- A web viewer at `/admin/audit-log` (admin/auditor only) renders the same data.

## Retention

Audit records are retained for **7 years** (see
[policies/data-classification.md](../policies/data-classification.md) and
[policies/security.md](../policies/security.md)). Hard purge beyond retention is
an `app_admin` scheduled job that respects this window; it is not yet deployed
(tracked as a follow-up — the table is append-only and small relative to
operational data, so retention is met by default today).

## Evidence

- Coverage: `grep "AFTER INSERT OR UPDATE OR DELETE ON" packages/db/sql/*.sql`.
- Trigger fires on I/U/D: integration test
  `apps/api/test/integration/audit-trigger.spec.ts` (skips without a DB).
- Tenant scoping + redaction: `apps/api/src/modules/admin/admin.spec.ts`.
- Live trail: `GET /admin/audit-log` and the `/admin/audit-log` UI.

**Owner:** CTO.
