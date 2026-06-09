# Vendor / Subprocessor Inventory

Third parties that process, store, or transmit US Tow Dispatch data, or that are
critical to availability. Reviewed annually (CC9.2) and on onboarding of any new
subprocessor. Each vendor's own SOC 2 / ISO report is collected and filed.

| Vendor | Purpose | Data shared | Criticality | Compliance posture |
|---|---|---|---|---|
| **Railway** | App + managed PostgreSQL + Redis hosting | All tenant data at rest, in transit | Critical | SOC 2 Type II (provider). https://railway.com/legal/compliance |
| **Stripe** | Payments (Stripe Connect, per-tenant payouts) | Cardholder data (tokenized), payout/bank metadata | Critical | PCI DSS Level 1; SOC 1/2. https://stripe.com/docs/security |
| **SendGrid (Twilio)** | Transactional email (invites, verification, statements) | Recipient email, names, invoice metadata | High | SOC 2 Type II. https://www.twilio.com/en-us/legal/compliance |
| **Twilio** | SMS (tracking links, red-alert notifications) | Recipient phone numbers, message content | High | SOC 2 Type II. https://www.twilio.com/en-us/legal/compliance |
| **Sentry** | Error monitoring / APM | Stack traces, request IDs (PII redacted from logs) | Medium | SOC 2 Type II. https://sentry.io/security/ |
| **Mapbox** | Geocoding, directions, map tiles | Pickup/dropoff coordinates, addresses | Medium | SOC 2 Type II. https://www.mapbox.com/trust-center |
| **Intuit QuickBooks Online** | Accounting sync (opt-in per tenant) | Invoice, customer, payment records | Medium (opt-in) | SOC 2; https://security.intuit.com |
| **Agero** (Phase 1) | Motor-club dispatch ingestion | Job dispatch payloads | Medium | Contractual; partner security review pending |
| **GitHub** | Source control, CI, branch protection | Source code, no customer data | High | SOC 2 Type II. https://github.com/security |
| **Anthropic (Claude Code)** | Engineering tooling | Source code during dev sessions; no production customer data | Low | https://www.anthropic.com/trust |

## Data-sharing notes

- **PII redaction**: outbound logs to Sentry redact PII per ARCHITECTURE.md §10.
  Audit-log snapshots returned by the admin reader redact secrets (see
  [audit-logging.md](controls/audit-logging.md)).
- **Card data**: never touches our servers in raw form — Stripe Elements
  tokenizes client-side; we store only Stripe identifiers. PCI scope is
  minimized by design and formally assessed in S40.
- **Sub-processor changes**: a new subprocessor requires a CTO-approved risk
  review (CC9.2) and an update to this file before production use.

## Subprocessor SOC report tracking (Type II — Session 40)

For SOC 2 Type II we must show vendor risk review *operated* over the window:
each critical/high subprocessor's own attestation is collected and kept current.
`next_review_at` is the trigger for the annual re-collection (CC9.2).

| Vendor | Report type | last_soc_report_received_at | expires_at | next_review_at |
|---|---|---|---|---|
| Railway | SOC 2 Type II | 2026-05-24 | 2027-03-31 | 2027-02-01 |
| Stripe | PCI DSS L1 AOC + SOC 2 | 2026-05-24 | 2027-04-30 | 2027-03-01 |
| SendGrid (Twilio) | SOC 2 Type II | 2026-05-24 | 2027-03-31 | 2027-02-01 |
| Twilio | SOC 2 Type II | 2026-05-24 | 2027-03-31 | 2027-02-01 |
| Sentry | SOC 2 Type II | 2026-05-24 | 2027-03-31 | 2027-02-01 |
| Mapbox | SOC 2 Type II | 2026-05-24 | 2027-03-31 | 2027-02-01 |
| GitHub | SOC 2 Type II | 2026-05-24 | 2027-03-31 | 2027-02-01 |
| Intuit QBO | SOC 2 | 2026-05-24 | 2027-03-31 | 2027-02-01 |

> Dates are placeholders set at inventory creation; replace `*_received_at` with
> the actual collection date and `expires_at` with the report's stated coverage
> end when each report is filed. Collected reports are stored under
> `compliance/evidence/vendors/<vendor>/<year>/` (access restricted; retention
> ≥ 18 months). A report past `expires_at` without a refresh is a CC9.2 finding.

## Review log

| Date | Reviewer | Notes |
|---|---|---|
| 2026-05-24 | CTO | Initial inventory for SOC 2 Type I (Session 31). |
| 2026-05-24 | CTO | Added SOC report tracking (received/expires/next-review) for Type II; PCI SAQ A-EP scope assessed (Session 40). |
