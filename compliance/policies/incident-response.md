# Incident Response Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual (+ after every Sev-1/Sev-2)

## Purpose

Define how US Tow Dispatch detects, triages, responds to, communicates, and
learns from security and availability incidents.

## Severity levels

| Sev | Definition | Examples | Response target |
|---|---|---|---|
| **Sev-1** | Confirmed breach or full outage; customer data at risk or system unusable | Cross-tenant data exposure, DB down, credential dump | Ack ≤ 15 min; all-hands; customer comms ≤ 24h (or per law) |
| **Sev-2** | Partial outage or significant security event, no confirmed data loss | Auth service degraded, token-reuse spike, payment webhook failing | Ack ≤ 30 min; on-call + lead |
| **Sev-3** | Minor / contained; workaround exists | Single-tenant bug, elevated error rate | Next business day |
| **Sev-4** | Informational | Suspicious but unconfirmed signal | Triage in backlog |

## Roles

- **Incident Commander (IC).** Owns the response, declares severity, coordinates.
- **On-call engineer.** First responder. *(Rotation: PLACEHOLDER — wire to
  PagerDuty/Opsgenie in Phase 1; until then the CTO is the standing on-call.)*
- **Comms lead.** Owns customer/status-page communication (often the IC for
  small teams).

## Process

1. **Detect** — via Sentry alert, audit-log anomaly, metrics WARN, or report.
2. **Declare** — open a GitHub issue using `.github/ISSUE_TEMPLATE/incident.md`;
   set severity; page on-call for Sev-1/2.
3. **Contain** — stop the bleeding (revoke tokens, disable a path, scale, fail
   over). Preserve evidence (audit log, logs, Sentry).
4. **Eradicate & recover** — fix root cause; restore service; verify via health
   checks and targeted tests.
5. **Communicate** — update the status page; notify affected customers per the
   timeline above and applicable breach-notification law.
6. **Post-mortem** — within 5 business days for Sev-1/2 (template below).

## Communication template

```
[US Tow Dispatch] Service Incident — <short title>
Status: Investigating | Identified | Monitoring | Resolved
Start: <UTC>    Severity: Sev-<n>
Impact: <who/what is affected, in plain language>
Current action: <what we are doing now>
Next update: <UTC, ≤ cadence for severity>
```

## Post-mortem template (blameless)

```
# Post-mortem: <title> (<date>)
- Severity / duration:
- Impact (customers, data, revenue):
- Timeline (UTC): detection → declaration → containment → recovery
- Root cause:
- What went well / what didn't:
- Corrective actions (owner, due date, tracking issue):
- Did any control fail or need to be added? (feed back into compliance/)
```

Corrective actions are tracked to closure and reviewed in the next risk
assessment (CC3) and monitoring cycle (CC4).
