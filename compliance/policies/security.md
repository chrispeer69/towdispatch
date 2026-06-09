# Information Security Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual

## Purpose & scope

Defines how US Tow Dispatch protects the confidentiality, integrity, and
availability of customer and company data. Applies to all personnel,
contractors, systems, and the production environment.

## Principles

1. **Tenant isolation is sacred.** Multi-tenant data is segregated by
   PostgreSQL Row Level Security with `FORCE ROW LEVEL SECURITY`. No code path
   may weaken this without a written, reviewed exception in `ARCHITECTURE.md`.
2. **Least privilege.** Access follows the seven-role RBAC model; the app runs
   as a non-superuser DB role. See the [Access Control Policy](access-control.md).
3. **Everything auditable.** Every state-changing action is logged immutably
   (trigger-driven). See [audit-logging control](../controls/audit-logging.md).
4. **Secure by default.** TLS in transit; secrets in environment config
   validated at boot; PII and secrets redacted from logs and the audit reader.
5. **Defense in depth.** MFA for privileged roles, brute-force lockout,
   token-reuse detection, idempotency on external writes.

## Data retention

- **Audit log: 7 years.** Retained to support investigations and regulatory /
  examination periods. Append-only; hard purge beyond the window runs only as an
  `app_admin` job that respects retention.
- Operational records follow soft-delete (`deleted_at`); hard purge respects
  retention policy ([data classification](data-classification.md)).

## Cryptography

- Passwords: argon2id. Refresh tokens: stored hashed, rotated on use.
- Data in transit: TLS. Data at rest: encryption provided by Railway managed
  Postgres.

## Enforcement

Violations are handled per the [Acceptable Use Policy](acceptable-use.md) and may
result in access revocation or termination. Security exceptions require CTO
approval and documentation.

## Related

[Access Control](access-control.md) · [Change Management](change-management.md) ·
[Incident Response](incident-response.md) · [Vendor Management](vendor-management.md) ·
[Data Classification](data-classification.md) · [BCDR](bcdr.md) ·
[Acceptable Use](acceptable-use.md)
