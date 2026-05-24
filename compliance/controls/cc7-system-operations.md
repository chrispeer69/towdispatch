# Control: System Operations (CC7)

**Objective.** The organization detects and responds to security events,
evaluates them, and remediates identified deficiencies.

## Design

- **Detection (CC7.1, CC7.2).**
  - Trigger-driven **audit log** on every tenant table records who changed what,
    when, from where ([audit-logging.md](audit-logging.md)). Queryable by
    admins/auditors via `GET /admin/audit-log` and the `/admin/audit-log` UI.
  - Sentry captures exceptions; refresh-token-reuse raises an explicit security
    event; brute-force attempts recorded in `login_attempts`.
  - Metrics + slow-query/endpoint WARN surface anomalous behavior (CC4).
- **Response (CC7.3, CC7.4).** Security events follow the
  [Incident Response Policy](../policies/incident-response.md): severity
  triage, on-call engagement, customer comms, and a post-mortem with corrective
  actions. The `.github/ISSUE_TEMPLATE/incident.md` template standardizes
  capture.
- **Vulnerability management (CC7.1).** Dependency updates reviewed via PR;
  `pnpm` overrides pin known-safe transitive versions (see root `package.json`).

## Evidence

- Audit-log API + trigger coverage (`audit-logging.md`).
- Incident issues created from the template; post-mortems filed.
- Sentry events for security signals.

**Owner:** CTO.
