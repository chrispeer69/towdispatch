# Data Classification & Retention Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual

## Classification

| Class | Definition | Examples | Handling |
|---|---|---|---|
| **Restricted** | Secrets / regulated | Password hashes, MFA secrets, refresh-token hashes, Stripe identifiers | Never logged; redacted from audit reader; encrypted at rest; access strictly least-privilege |
| **Confidential** | Customer PII / business data | Customer names, phones, addresses, job/invoice/payment records | Tenant-isolated (RLS); PII redacted from logs; soft-delete |
| **Internal** | Non-public operational data | Metrics, audit log, config (non-secret) | Access-controlled; audit log retained 7y |
| **Public** | Intended for public release | Marketing, status page | No restriction |

## Handling rules

- **Restricted data is never returned by the audit-log reader** — fields whose
  names end in `_hash` or contain `secret`/`password` are redacted server-side
  (see [audit-logging control](../controls/audit-logging.md)).
- PII is redacted from application logs and Sentry (ARCHITECTURE.md §10).
- Card data is tokenized by Stripe client-side and never stored raw.

## Retention

| Data | Retention | Mechanism |
|---|---|---|
| **Audit log** | **7 years** | Append-only; `app_admin` purge job respects window |
| Operational business records | Life of account + contractual/legal minimum | Soft-delete (`deleted_at`); retention-aware purge |
| Application logs | Per log-aggregation retention (≥ 90 days) | Provider-managed |
| Backups | Per [BCDR policy](bcdr.md) | Railway managed |

Hard deletion only ever happens via a scheduled `app_admin` purge that enforces
the retention windows above — never from application code.
