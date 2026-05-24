# Penetration Testing Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual

Covers SOC 2 CC4.1 / CC7.1 and PCI DSS Req 11.

## Requirement

An **annual** external penetration test is performed by an independent
third-party firm, plus an additional test after any **significant change** to the
application architecture or the cardholder-data page (PCI Req 11.3).

## Scope

- Public web application and API (authenticated + unauthenticated).
- AuthN/AuthZ: tenant isolation (RLS), role escalation, session handling, MFA.
- The checkout/payment page that loads Stripe Elements (PCI SAQ A-EP scope —
  script integrity, CSP, redirection/skimming risk).
- OWASP Top 10 + business-logic abuse (cross-tenant data access, impound/lien
  workflow tampering, payout/refund abuse).
- Out of scope: Stripe's infrastructure (covered by Stripe's own PCI L1), Railway
  platform internals (provider attestation).

## Vendor selection criteria

- CREST / OSCP-credentialed testers or equivalent demonstrable track record.
- Experience with multi-tenant SaaS and PCI-scoped e-commerce.
- Manual testing (not scanner-only); methodology mapped to OWASP/PTES.
- Clear remediation-retest included; written report with severity ratings.
- Willing to sign an NDA and operate under a defined rules-of-engagement window.

**Current vendor: TBD** (CTO to select; tracked as a 🟡 deferral in
[SESSION_40_DECISIONS.md](../../SESSION_40_DECISIONS.md)).

## Remediation

Findings are triaged and remediated under the
[vulnerability-management.md](vulnerability-management.md) SLA (critical 7d /
high 30d / medium 90d). A remediation-retest confirms closure before the
engagement is signed off.

## Evidence storage

The signed pen-test report and the remediation-retest letter are filed under
`compliance/evidence/pentest/<year>/` (retention ≥ 18 months; access restricted
to CTO/CEO). **Placeholder until the first engagement completes.**
