# PCI DSS — Annual Self-Assessment Report (ASAR) Skeleton

SAQ A-EP self-assessment record. Completed annually by the CTO (or a QSA if a
customer/acquirer requires one). This is the skeleton; the completed + signed
copy is filed under `compliance/evidence/` for the assessment year.

## Part 1 — Merchant & assessment information

- Company: US Tow Dispatch
- Assessment type: Self-Assessment (SAQ A-EP, PCI DSS v4.0)
- Assessment period: ______________ to ______________
- Assessor: ______________ (internal: CTO / external: QSA name)
- Acquirer / payment brand contact: ______________ (via Stripe)

## Part 2 — Executive summary

- Payment channel: e-commerce; Stripe Elements (PAN entered in Stripe-hosted
  iframe; tokenized client-side).
- Cardholder data stored: **none** (Stripe identifiers only).
- See [scope.md](scope.md) and [network-diagram.md](network-diagram.md).

## Part 3 — SAQ A-EP requirement attestation

For each applicable requirement, record: **In Place / Not Applicable / Not in
Place (+ remediation date)**. Mapping and current state: [controls.md](controls.md).

| Req | Status | Notes / evidence ref |
|---|---|---|
| 1 — Network security controls | In Place | |
| 2 — Secure configurations | In Place | |
| 3 — Protect stored account data | In Place (N/A storage) | `verify-stripe-only.ts` |
| 4 — Encrypt transmission | In Place | TLS / HSTS |
| 5 — Anti-malware | In Place | |
| 6 — Secure development | In Place | `security-scan.yml` |
| 6.4.3 / 11.6.1 — Payment-page script integrity | In Place | CSP pin; SRI hardening recommended |
| 7 — Restrict access (need-to-know) | In Place | RBAC + RLS |
| 8 — Authenticate access | In Place | argon2id, MFA, lockout |
| 9 — Physical access | In Place (inherited) | Railway |
| 10 — Log & monitor | In Place | `audit_log`, anomaly surface, `verify-no-pan-logs.ts` |
| 11 — Test security | In Place / Pending | annual pen test (vendor TBD 🟡) |
| 12 — Security policy | In Place | `compliance/policies/` |

## Part 4 — Action plan for "Not in Place" items

| Requirement | Target date | Owner |
|---|---|---|
| (none open at skeleton creation) | | |

## Part 5 — Attestation of Compliance (AOC)

- Signature (CTO): ______________  Date: __________
- Signature (CEO): ______________  Date: __________

> Filed copies, including the prior year's signed ASAR and the latest external
> pen-test report, live under `compliance/evidence/` (retention ≥ 18 months; see
> [SESSION_40_DECISIONS.md](../../SESSION_40_DECISIONS.md) D4).
