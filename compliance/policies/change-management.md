# Change Management Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual

## Purpose

Ensure all changes to code, schema, infrastructure, and procedures are
authorized, tested, reviewed, and traceable.

## Source control & review

- All work happens on a **feature branch**; **direct commits to `master` are
  prohibited**.
- Every change merges via a **pull request** requiring **at least one approving
  review** from someone other than the author.
- `master` branch protection enforces "require PR + ≥1 review" and required
  status checks. Verified by `scripts/compliance/verify-branch-protection.ts`
  (`--strict` in CI).

## Testing gates (CI)

`.github/workflows/e2e.yml` runs on every PR and must pass before merge:

- Tenant-isolation (RLS) and RLS-bypass tests
- Role-matrix (RBAC) enforcement
- Auth flows (refresh reuse, MFA enforcement)
- Payment webhook idempotency
- Accessibility (axe-core) + Lighthouse thresholds
- Migration sequence/naming/RLS checks (`scripts/check-migrations.sh`)

A failing build blocks merge.

## Database changes

- Migrations are **forward-only**, reviewed in PR, and validated by
  `check-migrations.sh` (naming, ordering, header doc block, RLS coverage).
- New tenant tables must add `tenant_id`, RLS policy, audit trigger, and
  `deleted_at` (ARCHITECTURE.md §12).

## Deployment

- Production deploys originate from merged `master` (Railway).
- Emergency changes still go through PR; if shipped hot, a retroactive review is
  completed within one business day and noted in the PR.

## Traceability

PR history, CI run records, and the audit log together reconstruct every change
and its authorization.
