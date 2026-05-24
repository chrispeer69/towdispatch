---
name: Security / Availability Incident
about: Declare and track a security or availability incident (SOC 2 CC7, A1)
title: "[INCIDENT][Sev-?] <short title>"
labels: ["incident", "security"]
assignees: []
---

> Open this the moment an incident is suspected. Set the severity in the title.
> See `compliance/policies/incident-response.md` for the full process.

## Severity

- [ ] **Sev-1** — confirmed breach or full outage; customer data at risk
- [ ] **Sev-2** — partial outage / significant security event, no confirmed loss
- [ ] **Sev-3** — minor / contained; workaround exists
- [ ] **Sev-4** — informational / unconfirmed

## Summary

<!-- One or two plain-language sentences: what is happening and who is affected. -->

## Detection

- **Detected at (UTC):**
- **Detected by:** <!-- Sentry alert / audit-log anomaly / metrics WARN / report -->
- **Incident Commander:**

## Impact

- **Customers/tenants affected:**
- **Data involved (class):** <!-- Restricted / Confidential / Internal -->
- **Services affected:**

## Timeline (UTC)

| Time | Event |
|---|---|
|  | Detected |
|  | Declared |
|  | Contained |
|  | Recovered |

## Containment & recovery

- [ ] Bleeding stopped (tokens revoked / path disabled / scaled / failed over)
- [ ] Evidence preserved (audit log, logs, Sentry events)
- [ ] Root cause identified
- [ ] Service restored & verified (`/ready`, targeted tests)

## Communication

- [ ] Status page updated
- [ ] Affected customers notified (per IR policy timeline / applicable law)

## Post-mortem (Sev-1/2 — within 5 business days)

- [ ] Blameless post-mortem written (template in `incident-response.md`)
- [ ] Corrective actions filed as tracked issues with owners + due dates
- [ ] Did a control fail or need adding? Update `compliance/` accordingly.
