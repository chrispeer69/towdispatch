# Vendor / Subprocessor Management Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual

## Purpose

Ensure third parties that process company or customer data, or that are critical
to availability, are vetted, inventoried, and monitored (CC9.2).

## Onboarding a vendor / subprocessor

1. Identify the data shared and the purpose; apply data minimization.
2. Review the vendor's security posture — SOC 2 / ISO report, DPA, breach
   history. Collect and file their report.
3. Assign a criticality (Critical / High / Medium / Low).
4. **CTO approval** required before production use.
5. Add the vendor to [vendors.md](../vendors.md) **before** it goes live.

## Ongoing monitoring

- **Annual review** of every vendor: re-collect SOC 2 reports, re-confirm data
  shared and criticality, log the review in `vendors.md`.
- Material vendor security incidents trigger our own incident process if
  customer data may be affected.

## Offboarding

- Revoke credentials/API keys, confirm data deletion per contract, update
  `vendors.md`.

## Current inventory

See [vendors.md](../vendors.md).
