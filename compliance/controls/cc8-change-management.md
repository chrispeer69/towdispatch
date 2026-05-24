# Control: Change Management (CC8)

**Objective.** The organization authorizes, designs, develops, tests, approves,
and implements changes to infrastructure, data, software, and procedures.

## Design

- **Branch-then-PR, always.** No direct commits to `master` (operating rule #7,
  `CLAUDE.md`). Every change lands via a pull request.
- **Peer review required.** `master` is protected to require a pull request and
  at least one approving review before merge. Verified by
  `scripts/compliance/verify-branch-protection.ts` (run `--strict` in CI to
  enforce).
- **Automated testing gate.** `.github/workflows/e2e.yml` runs the security and
  e2e suites on every PR — tenant isolation, role matrix, auth flows, payment
  webhook idempotency, a11y, migration sequence. A red build blocks merge.
- **Schema changes** are forward-only, reviewed in PR, and checked by
  `scripts/check-migrations.sh` (naming, ordering, header block, RLS coverage
  spot-check on new tables).
- **Separation of duties.** The author and the approving reviewer are different
  people; production deploys flow from `master` post-merge.

## Evidence

- Branch-protection settings (`verify-branch-protection.ts`).
- PR history showing review approvals before merge.
- CI run history; `check-migrations.sh` in the pipeline.

**Owner:** CTO.
