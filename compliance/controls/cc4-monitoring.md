# Control: Monitoring Activities (CC4)

**Objective.** The organization selects, develops, and performs ongoing and
separate evaluations to ascertain whether controls are present and functioning,
and communicates deficiencies in a timely manner.

## Design

- **Ongoing monitoring.**
  - Error monitoring via **Sentry** (`SENTRY_DSN`); every exception escaping the
    global filter is captured with its `request_id`.
  - Metrics via **prom-client** at `/metrics`: HTTP histograms, DB query
    histograms. Slow queries (>250 ms) and slow endpoints emit `WARN`.
  - Liveness/readiness at `/health` and `/ready`.
- **Separate evaluation.** `pnpm compliance:check` is an on-demand control
  self-test; CI (`e2e.yml`) re-evaluates security invariants on every PR; the
  quarterly access review and annual restore drill are separate evaluations.
- **Deficiency communication.** Findings route to GitHub issues (incident
  template) and, for security events, to Sentry + on-call per the
  [Incident Response Policy](../policies/incident-response.md).

## Evidence

- Sentry project; `/metrics` scrape; slow-query WARN log samples.
- `pnpm compliance:check` output; CI run history.

**Owner:** CTO.
