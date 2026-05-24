# Control: Control Activities (CC5)

**Objective.** The organization selects and develops control activities (and
general IT controls) that mitigate risks to the achievement of objectives, and
deploys them through policy and procedure.

## Design — control activities built into the platform

| Risk | Control activity | Where |
|---|---|---|
| Cross-tenant exposure | RLS + `FORCE ROW LEVEL SECURITY`; per-request `SET LOCAL` | `apps/api/src/database/tenant-aware-db.service.ts`; `0003_rls_policies.sql` |
| Untracked changes | Trigger-driven audit log | `0004_audit_trigger.sql` |
| Data loss via deletes | Soft delete (`deleted_at`) only; no app-path hard delete | `ARCHITECTURE.md §5` |
| Invalid input | Zod validation at the boundary | `ZodValidationPipe`, `packages/shared/src/schemas/` |
| Unsafe IDs | UUIDv7 only (no enumerable serials) | `ARCHITECTURE.md §6` |
| Unauthorized writes | `@Roles` + `RolesGuard`; idempotency keys on external writes | `apps/api/src/common/guards/` |

These are enforced by code and policy, not discretion. Deployment of new control
activities follows the change-management process ([cc8](cc8-change-management.md)).

## Evidence

- CI security suite: `rls.spec.ts`, `role-matrix.spec.ts`, `rls-bypass.spec.ts`.
- `scripts/check-migrations.sh` (RLS coverage spot-check on new tables).
- ARCHITECTURE.md "bar for new code" §12.

**Owner:** CTO.
