# Control: Risk Mitigation (CC9)

**Objective.** The organization identifies, selects, and develops risk
mitigation activities for risks arising from potential business disruptions and
the use of vendors/business partners.

## Design

- **Business disruption (CC9.1).** Availability risks are mitigated by managed,
  backed-up infrastructure and a documented recovery procedure — see
  [a1-availability.md](a1-availability.md) and
  [policies/bcdr.md](../policies/bcdr.md). Insurance (cyber + E&O) is maintained
  at the corporate level.
- **Vendor / subprocessor risk (CC9.2).** Every subprocessor is inventoried in
  [vendors.md](../vendors.md) with purpose, data shared, criticality, and its
  own compliance posture. A new subprocessor requires a CTO-approved risk review
  and a `vendors.md` update **before** production use. Vendor SOC 2 reports are
  collected and reviewed annually.
- **Data minimization with vendors.** Card data is tokenized client-side by
  Stripe and never stored raw; logs to Sentry are PII-redacted; audit snapshots
  are secret-redacted.

## Evidence

- [vendors.md](../vendors.md) inventory + annual review log.
- Collected vendor SOC 2 / ISO reports (filed in `compliance/evidence/`).
- Insurance certificates (manual).

**Owner:** CEO.
