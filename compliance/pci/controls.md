# PCI DSS v4.0 — Requirement Mapping (SAQ A-EP)

How each of the 12 PCI DSS requirements is met, reusing the technical controls
already shipped for SOC 2 (Session 31). "Gap" = work tracked beyond this session.

| # | Requirement | How we meet it | Evidence | Gap |
|---|---|---|---|---|
| 1 | Install and maintain network security controls | Railway-managed network; no inbound to DB except app roles; CORS allow-list (`CORS_ORIGINS`) | Railway config, `config.schema.ts` | — |
| 2 | Apply secure configurations | No vendor defaults; strict env validation refuses boot on misconfig; least-priv DB roles (app_user/app_admin) | `config.schema.ts`, RLS setup | — |
| 3 | Protect stored account data | **No PAN/CVV stored — ever.** Only Stripe ids. AES-256-GCM for our own secrets at rest | `verify-stripe-only.ts` (CI gate), schema | — |
| 4 | Protect cardholder data in transit | PAN goes browser→Stripe over TLS directly; our endpoints are HTTPS-only; HSTS | TLS config, CSP | — |
| 5 | Protect against malware | Managed runtime; no untrusted file execution; dependency scanning | `dependency-scan.ts`, Dependabot | — |
| 6 | Develop and maintain secure systems | Branch-then-PR, review required, CI gates, weekly dep + CodeQL scan, remediation SLA | `verify-branch-protection.ts`, `security-scan.yml`, [vulnerability-management.md](../policies/vulnerability-management.md) | — |
| 7 | Restrict access by business need-to-know | Seven-role RBAC, least privilege, RLS tenant isolation | `list-users-roles.ts`, `cc6-logical-access.md` | — |
| 8 | Identify users and authenticate access | Unique accounts, argon2id, MFA, lockout on failed logins | `cc6-logical-access.md`, MFA enrollment | — |
| 9 | Restrict physical access | Inherited from Railway data centers (SOC 2 / PCI provider) | Railway attestation ([vendors.md](../vendors.md)) | — |
| 10 | Log and monitor all access | Trigger-driven `audit_log` on every tenant table; admin reader; **anomaly surface** (`/admin/audit-log/anomalies`); PAN never logged | `verify-no-pan-logs.ts`, `audit-logging.md`, [monitoring.md](../policies/monitoring.md) | — |
| 11 | Test security of systems regularly | Annual external pen test; weekly automated scanning; CDE-boundary CI gates | [penetration-testing.md](../policies/penetration-testing.md), `security-scan.yml` | Pen-test vendor TBD (🟡) |
| 12 | Support information security with policies | Full policy set in `compliance/policies/`; annual review; vendor management | policy set, [vendors.md](../vendors.md) | — |

## SAQ A-EP specifics

- **6.4.3 / 11.6.1 — payment page script integrity & change detection.** The
  checkout page loads only `js.stripe.com` (pinned in `CSP_SCRIPT_SRC` /
  `CSP_FRAME_SRC`). Any change to the payment page goes through branch protection
  + review (Req 6). Subresource Integrity + a tightened CSP are the recommended
  hardening for the script-integrity sub-requirement.
- **Eligibility:** valid only while all account data entry stays in the
  Stripe-hosted element. The two CI gates (`verify-stripe-only`,
  `verify-no-pan-logs`) are what keep us inside SAQ A-EP — if either is removed or
  a raw card field is introduced, scope jumps to SAQ D and this mapping is void.
