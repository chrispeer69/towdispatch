# Control: Communication & Information (CC2)

**Objective.** The organization obtains/generates relevant quality information
and communicates it — internally and externally — to support the functioning of
internal control.

## Design

- **Internal.** Security policies live in `compliance/policies/` and are
  socialized to all staff; engineering invariants in `ARCHITECTURE.md` and
  `CLAUDE.md` are required reading. Changes are communicated via PR review.
- **Information quality.** Structured logging (Pino) with a `request_id` on
  every line; metrics via prom-client; the audit log is the authoritative record
  of who-did-what ([audit-logging.md](audit-logging.md)).
- **External.** Customers receive a public status page and breach/incident
  notifications per the [Incident Response Policy](../policies/incident-response.md).
  Subprocessors and their compliance posture are published in
  [vendors.md](../vendors.md).

## Evidence

- Policy set in `compliance/policies/` (this PR).
- Status page URL (manual); incident-notification templates in the IR policy.
- Sample structured log line + Sentry event showing `request_id` propagation.

**Owner:** CTO.
