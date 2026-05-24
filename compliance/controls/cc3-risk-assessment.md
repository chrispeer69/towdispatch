# Control: Risk Assessment (CC3)

**Objective.** The organization specifies objectives clearly enough to identify
and assess risks, considers fraud, and identifies changes that could
significantly impact the system of internal control.

## Design

- **Annual risk assessment** maintained in a risk register: assets, threats,
  likelihood × impact, treatment. Owned by the CTO, reviewed by the CEO.
- **Threat model.** The dominant risk for a multi-tenant SaaS is cross-tenant
  data exposure; it is mitigated structurally by RLS + `FORCE ROW LEVEL
  SECURITY` and gated in CI ([cc6-logical-access.md](cc6-logical-access.md)).
  Secondary risks: credential compromise (MFA, lockout), payment fraud (Stripe),
  availability (backups/DR).
- **Fraud consideration.** Financial mutations (invoices, payments, credit
  memos) are audited; privileged-account changes are audited and reviewed.
- **Change risk.** New subprocessors trigger a vendor risk review (CC9.2);
  schema changes are reviewed in PR and checked by `scripts/check-migrations.sh`.

## Evidence

- Risk register (manual, annual) + sign-off.
- Vendor risk reviews in [vendors.md](../vendors.md).
- CI evidence that the top risk (tenant isolation) is continuously tested.

**Owner:** CTO.
