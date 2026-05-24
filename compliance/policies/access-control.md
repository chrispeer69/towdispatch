# Access Control Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual

## Purpose

Ensure access to systems and data is granted on a least-privilege, need-to-know
basis, authenticated strongly, and reviewed regularly.

## Authentication

- All users authenticate with email + password (argon2id) and a rotating
  refresh-token session.
- **MFA is mandatory for `OWNER` and `ADMIN` roles** and recommended for all.
  Privileged users cannot obtain access tokens until MFA is enrolled.
- Accounts lock after 5 failed attempts in 15 minutes with doubling backoff.

## Authorization (RBAC)

- Seven roles, least privilege, enforced server-side on every protected route.
  See the [Access Control control doc](../controls/access-control.md) for the
  full role/authority matrix.
- The read-only `auditor` role is provisioned for external auditors and internal
  review; it can read the audit log and read views but cannot mutate data.
- Privileged operations (user create/deactivate, role change, billing) are
  restricted to `OWNER`/`ADMIN` and are audited.

## Provisioning & de-provisioning

- Access is requested/approved by an `OWNER`/`ADMIN` via invite + role
  assignment.
- On role change or offboarding, access is revoked promptly via soft-delete +
  `is_active = false`; the change is audited.

## Access review

- **Quarterly**, the CTO reviews the full user/role roster
  (`scripts/compliance/list-users-roles.ts`) and the privileged-account
  inventory (`list-admins.ts`), confirms each assignment is still justified, and
  files the signed export in `compliance/evidence/`.
- Any active privileged account without MFA is remediated immediately.

## Tenant data segregation

Cross-tenant access is prevented by RLS (`FORCE ROW LEVEL SECURITY`) and tested
in CI on every PR.
