# Control: Access Control / RBAC (CC6.1, CC6.2, CC6.3)

**Objective.** Access to tenant data and privileged functions is restricted to
authorized users, follows least privilege, and is reviewed periodically.

## Authentication (CC6.1)

- Custom JWT access tokens + rotating refresh tokens (`sessions`, stored hashed,
  revocable). Passwords hashed with **argon2id**.
- **MFA enforcement**: `OWNER`/`ADMIN` without enrolled MFA receive
  `mfa_setup_required` and cannot obtain access tokens until they enroll
  (`apps/api/src/modules/auth/`).
- Brute-force lockout: 5 failed attempts / 15 min → lock with doubling backoff;
  all attempts recorded in `login_attempts`.
- Refresh-token reuse detection revokes the entire token family and raises a
  security event to Sentry.

## Authorization — the seven-role RBAC model (CC6.3)

Roles are defined in `packages/shared/src/constants/roles.ts` and enforced by
`@Roles(...)` + `RolesGuard` on every protected route. Privilege rank (higher =
more authority):

| Rank | Role | Intended access |
|---|---|---|
| 6 | `owner` | Full account control: billing, users, all operational data |
| 5 | `admin` | Operational + user management; no billing ownership transfer |
| 4 | `manager` | Dispatch, fleet, reporting; limited settings |
| 3 | `dispatcher` | Create/assign jobs, view operational board |
| 2 | `accounting` | Invoices, AR, payments, accounting sync; read ops |
| 1 | `driver` | Own jobs, shifts, evidence (in-truck app) only |
| 0 | `auditor` | **Read-only.** Audit log + read views; no mutations |

- **Least privilege**: the `auditor` role (rank 0) exists specifically so an
  external SOC 2 auditor gets read-only visibility (e.g. `GET /admin/audit-log`)
  without any mutate capability.
- Privileged actions (create user, deactivate user, change role) are gated to
  `OWNER`/`ADMIN`. Role changes are themselves audited (`users` table trigger).

## Tenant isolation (CC6.1)

Authorization to *another tenant's* data is impossible by construction:
PostgreSQL **Row Level Security** with `FORCE ROW LEVEL SECURITY` on every
tenant table, enforced via `SET LOCAL app.current_tenant_id` per request. CI
gate: `apps/api/test/integration/rls.spec.ts` must pass on every PR. See
[cc6-logical-access.md](cc6-logical-access.md).

## Provisioning & de-provisioning (CC6.2, CC6.3)

- Users are invited (`user_invites`) and assigned a role by an `OWNER`/`ADMIN`.
- De-provisioning is **soft delete** (`deleted_at`) + `is_active = false`; the
  account immediately loses access (RLS + guard) and the action is audited.
- **Quarterly access review**: export `scripts/compliance/list-users-roles.ts`
  and `list-admins.ts`; the CTO confirms each assignment — especially privileged
  and MFA-less accounts — is still justified, and files the signed export in
  `compliance/evidence/`.

## Evidence

- RBAC source of truth: `packages/shared/src/constants/roles.ts`.
- Guard enforcement: `apps/api/src/common/guards/roles.guard.ts`;
  role matrix test `apps/api/test/security/role-matrix.spec.ts`.
- Rosters: `pnpm compliance:check` → user/admin CSVs.
- Tenant isolation: `rls.spec.ts` (CI).

**Owner:** CTO.
