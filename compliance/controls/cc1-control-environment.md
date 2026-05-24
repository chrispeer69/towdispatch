# Control: Control Environment (CC1)

**Objective.** The organization demonstrates a commitment to integrity, ethical
values, board oversight, defined structure, competence, and accountability.

## Design

- **Structure & accountability.** Roles and reporting lines are defined; the
  seven-role RBAC model ([access-control.md](access-control.md)) maps system
  authority to job function. The CTO owns the security program; the CEO owns
  governance.
- **Integrity & ethics.** All personnel acknowledge the
  [Acceptable Use Policy](../policies/acceptable-use.md) and code of conduct on
  hire and annually.
- **Competence.** Engineering follows documented invariants (`ARCHITECTURE.md`,
  `CLAUDE.md`) and a branch-then-PR review process ([cc8](cc8-change-management.md)).
- **Accountability.** Every state-changing action is attributable via the audit
  log ([audit-logging.md](audit-logging.md)); privileged accounts are inventoried
  and reviewed quarterly.

## Evidence

- Org chart and signed code-of-conduct / acceptable-use acknowledgements (manual).
- RBAC matrix + privileged-account inventory (`list-admins.ts`).
- Documented invariants: `ARCHITECTURE.md`, this `compliance/` corpus.

**Owner:** CEO.
