# Control: Logical & Physical Access (CC6)

**Objective.** The organization implements logical and physical access controls
to protect against threats from unauthorized access.

## Logical access

Full detail in [access-control.md](access-control.md). Summary:

- **Identity & authentication (CC6.1).** JWT + rotating refresh tokens;
  argon2id passwords; MFA enforced for `OWNER`/`ADMIN`; brute-force lockout;
  refresh-token-reuse family revocation.
- **Authorization (CC6.1, CC6.3).** `@Roles` + `RolesGuard` on every protected
  route; seven-role least-privilege RBAC; read-only `auditor` role.
- **Tenant isolation (CC6.1).** PostgreSQL RLS with `FORCE ROW LEVEL SECURITY`
  on every tenant table; the app connects as the non-superuser `app_user`; each
  request runs `SET LOCAL app.current_tenant_id`. The owner role bypass is
  closed by `FORCE`. CI gate `apps/api/test/integration/rls.spec.ts` asserts: A
  sees only A's rows; A's update of B's rows affects 0; A's insert as B fails.
- **Provisioning/de-provisioning (CC6.2, CC6.3).** Invite + role assignment by
  admins; soft-delete + `is_active=false` removes access immediately; quarterly
  access review.
- **Credentials & secrets.** Secrets via env (Railway), validated at boot
  (`config.schema.ts`); never logged (PII/secret redaction); secret fields
  redacted from the audit reader.

## Physical access

The platform runs entirely on **Railway** managed infrastructure; physical and
environmental controls (data-center access, HVAC, power) are inherited from
Railway's provider and covered by Railway's SOC 2 report (see
[vendors.md](../vendors.md)). US Tow Dispatch operates no physical servers.

## Evidence

- `rls.spec.ts`, `rls-bypass.spec.ts`, `role-matrix.spec.ts` (CI).
- `list-users-roles.ts` / `list-admins.ts` rosters with MFA flags.
- Railway SOC 2 report (inherited physical controls).

**Owner:** CTO.
