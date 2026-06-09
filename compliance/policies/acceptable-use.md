# Acceptable Use Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual ·
**Acknowledgement:** on hire and annually

## Purpose

Define acceptable use of US Tow Dispatch systems, data, and credentials by
personnel and contractors.

## Rules

1. **Least privilege & need-to-know.** Access only the data required for your
   role. Do not attempt to access other tenants' data or escalate privilege.
2. **Credential hygiene.** Unique, strong passwords; enable MFA (mandatory for
   privileged roles). Never share credentials or tokens. Report suspected
   compromise immediately (Incident Response).
3. **Device security.** Company data is accessed only from devices with disk
   encryption, current OS patches, and screen lock.
4. **Production data.** Do not copy Restricted/Confidential data to local or
   unapproved locations. Evidence exports (e.g. user CSVs) are handled per the
   [Data Classification Policy](data-classification.md) and shared with auditors
   out-of-band, not committed to the repo.
5. **Secrets in code.** Never commit secrets. Secrets live in environment config.
   CI/secret scanning is expected to block accidental commits.
6. **Change discipline.** All changes via branch + reviewed PR; no direct pushes
   to `master` (see [Change Management](change-management.md)).
7. **Acceptable conduct.** No use of company systems for unlawful, harassing, or
   unauthorized purposes.

## Enforcement

Violations may result in access revocation, disciplinary action, or termination,
and where applicable, legal action. Exceptions require written CTO approval.
