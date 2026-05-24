# SOC 2 Control Matrix — US Tow DISPATCH

Maps each in-scope control to its implementation, the evidence that proves it
operates, and the accountable owner. Type I attests that controls are **designed**
and **in place** as of the report date; Type II (Session 40) will attest they
**operated effectively** over a period.

- **Report:** SOC 2 Type I
- **Trust Services Criteria in scope:** Security (CC1–CC9) + Availability (A1)
- **Out of scope (deferred to S40):** Confidentiality, Processing Integrity,
  Privacy; PCI DSS. See [SESSION_31_DECISIONS.md](../SESSION_31_DECISIONS.md).
- **As-of date:** 2026-05-24

| Control | TSC | Implementation | Evidence | Collector / source | Owner |
|---|---|---|---|---|---|
| [cc1-control-environment.md](controls/cc1-control-environment.md) | CC1 | Org structure, RBAC roles, background of founders, code of conduct | Org chart, RBAC matrix, signed acceptable-use | `list-admins.ts`, [access-control.md](controls/access-control.md) | CEO |
| [cc2-communication.md](controls/cc2-communication.md) | CC2 | Security policies published; ARCHITECTURE.md invariants; status page | Policy set in `compliance/policies/`, README onboarding | manual | CTO |
| [cc3-risk-assessment.md](controls/cc3-risk-assessment.md) | CC3 | Annual risk assessment; threat model; vendor risk review | Risk register, [vendors.md](vendors.md) | manual | CTO |
| [cc4-monitoring.md](controls/cc4-monitoring.md) | CC4 | Sentry, prom-client metrics, slow-query WARN, health probes | Sentry project, `/metrics`, dashboards | manual + `/health` | CTO |
| [cc5-control-activities.md](controls/cc5-control-activities.md) | CC5 | RLS, soft delete, Zod validation, CI gates | `rls.spec.ts`, CI workflow, ARCHITECTURE.md | e2e.yml | CTO |
| [cc6-logical-access.md](controls/cc6-logical-access.md) | CC6 | JWT auth, argon2id, MFA enforcement, RLS tenant isolation, RBAC | User/role CSV, MFA enrollment, RLS test | `list-users-roles.ts`, `list-admins.ts` | CTO |
| [cc7-system-operations.md](controls/cc7-system-operations.md) | CC7 | Audit log, anomaly alerts, incident response, vulnerability mgmt | Audit-log API, incident issues, depend.bot | [audit-logging.md](controls/audit-logging.md) | CTO |
| [cc8-change-management.md](controls/cc8-change-management.md) | CC8 | Branch-then-PR, review required, CI gates, migration review | Branch protection, PR history | `verify-branch-protection.ts` | CTO |
| [cc9-risk-mitigation.md](controls/cc9-risk-mitigation.md) | CC9 | Vendor SOC 2 review, insurance, BCDR | [vendors.md](vendors.md), BCDR policy | manual | CEO |
| [a1-availability.md](controls/a1-availability.md) | A1 | Railway managed Postgres, daily backups, DR runbook, health checks | Backup age check, restore drill log | `verify-backup.ts` | CTO |
| [audit-logging.md](controls/audit-logging.md) | CC7.2 | Trigger-driven `audit_log` on every tenant table; 7-yr retention; admin reader | Audit trigger coverage, `GET /admin/audit-log` | `audit-logging.md` + tests | CTO |
| [access-control.md](controls/access-control.md) | CC6.1–6.3 | Seven-role RBAC, least privilege, quarterly access review | RBAC matrix, user/admin CSVs | `list-users-roles.ts` | CTO |

## Evidence collection cadence

| Cadence | Activity |
|---|---|
| Continuous | Audit log (trigger), Sentry, metrics, CI on every PR |
| On demand | `pnpm compliance:check` → user/admin CSVs, branch-protection + backup checks |
| Quarterly | Access review (sample `list-users-roles.ts` output), policy re-acknowledgement |
| Annual | Risk assessment, vendor SOC 2 re-collection, restore drill, policy review |

`pnpm compliance:check` is the automated smoke test: it fails if any control
file here lacks an entry, any policy is missing, or any collector reports a
hard failure. See [evidence/README.md](evidence/README.md).
