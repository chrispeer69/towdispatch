# Session 40 — Decision Log

SOC 2 Type II + PCI DSS Level 1. Continuous evidence, operating-effectiveness
controls, PCI scope assessment, DR drill runbook, audit-log anomaly surface.

This builds directly on Session 31 (SOC 2 Type I). Type I attested controls were
**designed and in place** as of a date; Type II attests they **operated
effectively** over an observation window. The work here is the continuous /
period-of-time half of the same control set.

---

## D1 — Base branch: `feature/session-31-soc2-type1`, not `master`

**Decision.** `feature/session-40-soc2-type2-pci` was cut from
`origin/feature/session-31-soc2-type1`, not from `origin/master`.

**Why.** S31 is not yet merged to master — `compliance/` exists only on the S31
branch. Type II is, by definition, an *extension* of Type I: the launch brief
says "extend `compliance/vendors.md`", "extend the audit-log API from S31",
"touch S31's controls/policies dir except to extend". You cannot extend files
that aren't there. A master-based branch would force re-creating ~30 S31 files
as parallel copies, which *guarantees* a merge conflict on every shared file.
Basing off S31 means: when S31 lands, our duplicate-of-S31 commits become
no-ops and the S40 delta rebases cleanly; if S40 lands first, S31's PR collapses
to (near) empty. Clean under both merge orderings.

**PR hygiene.** The S40 PR will appear to contain S31's commits as a baseline.
Reviewers see the true S40 delta with
`git diff feature/session-31-soc2-type1...feature/session-40-soc2-type2-pci`.
Noted in the PR body.

## D2 — PCI DSS scope: SAQ A-EP

**Decision.** Self-Assessment Questionnaire **A-EP** (e-commerce, payment page
elements delivered by us but card data entered into a Stripe-hosted iframe /
Stripe.js, PAN never transiting our servers).

**Why.** We use Stripe Connect with Stripe.js / Elements (`js.stripe.com` in the
CSP allow-list; `STRIPE_PUBLIC_KEY` client-side). We control the page that
*loads* the Stripe element, but the cardholder enters the PAN directly into
Stripe's iframe — so we are SAQ A-EP, not SAQ A (fully outsourced page) and not
SAQ D (we never touch/store/transmit PAN). A-EP is the conservative correct fit:
it carries more requirements than SAQ A (we secure the surrounding page), which
is the safer assumption if an assessor disagrees on the A/A-EP boundary.

**Boundary, not implementation.** Per the brief, we do NOT modify the Stripe
payment flow. PCI work here is *scope definition + hygiene assertions* that the
CDE boundary holds (no PAN in logs, no raw card columns/fields).

## D3 — Type II observation window: 12 months

**Decision.** 12-month observation window (not 6).

**Why.** 12 months is the default auditor expectation for a mature Type II and
covers a full cycle of every periodic control (4 quarterly access reviews, an
annual pen test, an annual risk assessment, annual DR drills). A 6-month window
is an option for a first Type II under time pressure; we are building the
evidence pipeline now, so designing for the longer window costs nothing and
avoids re-baselining later. Evidence retention is set accordingly (D4).

## D4 — Evidence retention: 18 months minimum

**Decision.** Automated evidence retained ≥ 18 months. Stored git-tracked under
`compliance/evidence/automated/<date>/` (committed by the scheduled workflow),
so retention is the repository history — effectively indefinite, comfortably
over the 12-month window + audit fieldwork lag.

**Why git, not artifacts.** GitHub Actions artifacts cap at 400 days and aren't
tamper-evident as an audit trail. Committing JSON evidence to the repo gives an
immutable, timestamped, reviewable record that survives well past 18 months. The
collector never deletes; "minimum 18 months" means *don't prune earlier than
that*, which a keep-everything policy satisfies trivially.

## D5 — "Env-gated cron" = scheduled GitHub Actions workflow, gated by a repo variable

**Decision.** The daily 04:00 UTC evidence collection runs as a scheduled
GitHub Actions workflow (`.github/workflows/compliance-evidence.yml`), gated by
`if: vars.COMPLIANCE_EVIDENCE_CRON_ENABLED == 'true'` (default off). It is NOT a
NestJS `@Cron` inside the API.

**Why.** Evidence collection needs the `gh` CLI, `git`, `pnpm audit`, and write
access to a repo checkout — none of which the API container has. Every existing
NestJS cron (impound, tier-offer, dynamic-pricing) does *in-app DB work*;
forcing an ops/CI activity into the app process would be the wrong fit and
unrunnable in prod. CI is the idiomatic home for a daily node-script job that
commits its output. The env flag still gates it, exactly as the brief asks.

`COMPLIANCE_EVIDENCE_CRON_ENABLED` is therefore a GitHub repo **variable**, not
an API env var — it is deliberately NOT added to `apps/api/config.schema.ts`,
because the API does not read it (dead config is worse than no config).

## D6 — Anomaly sources: audit_log (admin deletes / off-hours) + users (failed-login)

**Decision.** `GET /admin/audit-log/anomalies` derives three signals, all
tenant-scoped through RLS (`runInTenantContext`), mirroring the S31 reader:
1. **Admin deletes** — `audit_log` DELETE rows whose actor (joined to `users`)
   holds an `owner`/`admin` role, within the window.
2. **Off-hours admin activity** — any `audit_log` row by an owner/admin actor
   whose `created_at` hour (UTC) falls in the off-hours band (default 22:00–06:00).
3. **Failed-login spikes** — `users` rows with `failed_login_count ≥ threshold`
   (default 5) or an active `locked_until`.

**Why these sources.** `audit_log` is trigger-written on every tenant table
mutation (INSERT/UPDATE/DELETE) and already RLS-scoped — it is the system of
record for "who changed what, when". Failed logins are *not* a table mutation,
so they aren't in `audit_log` as discrete events; the counter lives on
`users.failed_login_count` / `locked_until` (bumped by AuthService). Reading the
current counter is the available, tenant-scoped signal. This is an **advisory**
read surface (like S43 fraud detection) — it flags, it does not block.

## D7 — Collector failure semantics inherit S31's ok/warn/skip/fail

Reused S31's `_util.ts` contract verbatim: `ok`/`warn` exit 0, `skip` exit 3
(missing credential/unreachable — documented, non-fatal), `fail` exit 1.
`--strict` flips `warn`→`fail` for CI/auditor enforcement. The PCI hygiene
checks (`verify-no-pan-logs`, `verify-stripe-only`) are the exception: a positive
match is a **hard fail even without `--strict`**, because a leaked PAN is never
an acceptable "warn".

## D8 — DR drill is a runbook + evidence template, not a live failover

**Decision.** `dr-drill.ts` emits a per-quarter drill record template
(checklist, timing fields, sign-off) and the policy documents RPO 60s / RTO
15min carried forward from S44 (multi-region). It does NOT trigger a real
failover.

**Why.** A live failover against the S44 secondary is an operator-run, scheduled
maintenance activity with production blast radius — not something a CI script
should initiate. The deliverable is the *repeatable runbook + evidence shape*
the operator fills in each quarter; the brief explicitly scopes this as a
"runbook ... evidence template".

---

## Deferred (🟡)

- **Third-party auditor selection / formal Type II kickoff** — business decision,
  out of engineering scope.
- **Pen-test vendor selection** — policy documents the selection *criteria* and
  the report storage location (placeholder); the actual vendor is TBD by the CTO.
- **Real DR failover execution** — see D8; runbook shipped, execution is an ops
  event.
- **Live `pnpm audit` advisory triage** — `dependency-scan.ts` collects + scores;
  remediating any findings it surfaces is follow-up ops work under the documented
  SLA.
- **Per-event failed-login time series** — current design reads the counter on
  `users`; a discrete `auth_events` table (for true spike-over-time detection)
  is a larger schema change, parked.

## Explicitly NOT touched

- Stripe payment flow / PaymentsModule (PCI scope = boundary, not implementation).
- Auth flow (`auth.service.ts`) — read its schema only.
- S31 controls/policies content — extended (vendors.md, matrix.md), not rewritten.
- No new payment processors.
</content>
</invoke>
