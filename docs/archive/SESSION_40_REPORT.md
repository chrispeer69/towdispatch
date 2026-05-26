# Session 40 — SOC 2 Type II + PCI DSS L1

## TL;DR

Built the continuous / period-of-time half of the SOC 2 program on top of S31's
Type I foundation, plus a PCI DSS SAQ A-EP scope assessment with code-enforced
CDE-boundary gates.

- **10 continuous evidence collectors** (6 new + 4 reused) feeding a dated,
  manifest-indexed evidence pipeline (`pnpm compliance:collect`) with ≥18-month
  git-tracked retention.
- **Type II smoke gate** (`pnpm compliance:type2-check`) — coverage matrix +
  corpus + all collectors.
- **PCI DSS SAQ A-EP**: scope, controls, network diagram, ASAR skeleton + two
  hard-fail CI gates (`verify-no-pan-logs`, `verify-stripe-only`).
- **Audit-log anomaly API**: `GET /admin/audit-log/anomalies` (admin deletes,
  off-hours admin activity, failed-login spikes) — tenant-scoped, advisory.
- **4 new policies** (pen test, DR, monitoring, vuln mgmt) + Dependabot + a
  weekly CodeQL/audit workflow + a daily evidence workflow.
- **58 new tests** (41 root-script + 17 api admin). All green.

Base branch decision and all others: [SESSION_40_DECISIONS.md](SESSION_40_DECISIONS.md).

## Decision log (summary — full rationale in DECISIONS)

| # | Decision |
|---|---|
| D1 | Branch off `feature/session-31-soc2-type1`, not master (Type II *extends* Type I; nothing to extend on master) |
| D2 | PCI SAQ **A-EP** (Stripe Elements; PAN never on our servers; A-EP is the conservative A/A-EP boundary) |
| D3 | Type II observation window: **12 months** |
| D4 | Evidence retention ≥ **18 months**, git-tracked (immutable, tamper-evident) |
| D5 | "Env-gated cron" = scheduled GitHub Actions workflow gated by repo var, NOT a NestJS @Cron (needs gh/git/pnpm/fs) |
| D6 | Anomaly sources: `audit_log` (deletes/off-hours) + `users` (failed-login counter) |
| D7 | Inherit S31 ok/warn/skip/fail semantics; PCI hygiene checks hard-fail without `--strict` |
| D8 | DR drill = runbook + evidence template, not a live failover |

## What shipped ✅

### Continuous evidence (`scripts/compliance/`)
- ✅ `collect-evidence.ts` — daily orchestrator → `compliance/evidence/automated/<date>/` (per-control JSON + `manifest.json`)
- ✅ `evidence.ts` — evidence model + manifest helpers + 18-month retention constant
- ✅ `change-management.ts` (CC8.1) — % PRs reviewed, mean time-to-merge, rollback rate
- ✅ `incident-metrics.ts` (CC7.3) — incident count, MTTR, post-mortem rate
- ✅ `monitoring-sample.ts` (CC4.1) — health-endpoint up/latency sample
- ✅ `dependency-scan.ts` (CC7.1 / PCI 6,11) — `pnpm audit` severity vs SLA
- ✅ `quarterly-access-review.ts` (CC6.1–6.3) — quarterly markdown review, stale/never-logged-in/privileged-no-MFA
- ✅ `dr-drill.ts` (A1.2/A1.3) — per-quarter failover drill template (RPO 60s/RTO 15min)
- ✅ Reused S31 collectors: `list-users-roles`, `list-admins`, `verify-backup`, `verify-branch-protection`
- ✅ `type2-check.ts` — `pnpm compliance:type2-check` smoke gate

### PCI DSS L1 (`compliance/pci/`)
- ✅ `scope.md` (SAQ A-EP CDE boundary), `controls.md` (12-req mapping), `network-diagram.md` (mermaid), `asar.md` (ASAR skeleton)
- ✅ `verify-no-pan-logs.ts` — hard-fails on PAN literals / card-field logging (Luhn + MII + test-card allowlist)
- ✅ `verify-stripe-only.ts` — hard-fails on raw card columns/fields

### Monitoring effectiveness (API)
- ✅ `GET /admin/audit-log/anomalies` — extends S31 admin module; `audit-anomalies.ts` pure classifier; OWNER/ADMIN/AUDITOR; RLS tenant-scoped
- ✅ Shared contract added to `packages/shared/src/schemas/audit-log.ts`

### Policies + automation
- ✅ `policies/penetration-testing.md`, `disaster-recovery.md`, `monitoring.md`, `vulnerability-management.md`
- ✅ `.github/workflows/compliance-evidence.yml` (daily 04:00 UTC, repo-var gated, commits evidence)
- ✅ `.github/workflows/security-scan.yml` (weekly CodeQL + strict dep audit)
- ✅ `.github/dependabot.yml` (weekly npm + actions)
- ✅ Extended `matrix.md` (Type II + PCI delta) and `vendors.md` (SOC report tracking: received/expires/next-review)

### Tooling
- ✅ Root `vitest.config.ts` scoped to `scripts/**` + `vitest` root devDep so the compliance scripts have a test suite (none existed); `pnpm test` now chains it
- ✅ Fixed a latent `exactOptionalPropertyTypes` error in S31's `check.ts` (whole `scripts/compliance/` dir now tsc-clean)

## Deferred 🟡

- 🟡 **Third-party auditor selection / Type II kickoff** — business decision.
- 🟡 **Pen-test vendor** — policy documents selection criteria + report storage; vendor TBD by CTO.
- 🟡 **Live DR failover execution** — runbook shipped; execution is a scheduled ops event (D8).
- 🟡 **Dependency remediation** — `dependency-scan` surfaces 3 critical / 14 high / 29 moderate **pre-existing** advisories; triage under the documented SLA. Not introduced this session; the weekly `security-scan.yml` gates new ones.
- 🟡 **Per-event failed-login time series** — current anomaly surface reads the `users` counter; a discrete `auth_events` table is parked (D6).

## What was NOT touched

- Stripe payment flow / `PaymentsModule` (PCI scope = boundary, not implementation).
- Auth flow (`auth.service.ts`) — read its schema only.
- S31 controls/policies content — extended (matrix, vendors), not rewritten.
- No new payment processors.

## Test coverage

| Suite | Tests | Result |
|---|---|---|
| Root compliance scripts (`pnpm test:scripts`) | 41 | ✅ pass |
| API admin (anomalies + classifier + existing) | 17 | ✅ pass |
| `pnpm typecheck` (all workspaces) | — | ✅ pass |
| `pnpm biome check` (my files) | 37 files | ✅ 0 diagnostics |
| `pnpm build` | — | ✅ pass |
| `pnpm compliance:type2-check` | 25 ok / 2 warn / 5 skip / 0 fail | ✅ pass |

Each collector has positive + negative + missing-data unit tests; an integration
test drives the full `collectFrom` pipeline and validates the manifest.

## Known issues

- **Pre-existing (not a regression):** `apps/web` `offline-queue.spec.ts` fails
  locally (`window.location.hostname` undefined) — documented in prior sessions;
  web unit tests are not in CI. `pnpm test` chains web before the root scripts,
  so it aborts there; run `pnpm test:scripts` and the api suite directly to see
  the Session 40 tests green.
- **Solo-dev review coverage:** `change-management` reports ~0% PR review coverage
  because merged PRs in this repo carry no GitHub review records — an *accurate*
  WARN and a genuine Type II gap to close (second reviewer / self-review attestation).
- Collectors needing creds (`DATABASE_ADMIN_URL`, `gh`, backup/monitoring URLs)
  SKIP cleanly in environments without them.

## Commands

```bash
pnpm compliance:collect        # daily evidence set → compliance/evidence/automated/<date>/
pnpm compliance:type2-check    # Type II + PCI smoke gate
pnpm test:scripts              # compliance collector unit tests
tsx scripts/compliance/verify-no-pan-logs.ts     # PCI hard-fail gate
tsx scripts/compliance/verify-stripe-only.ts     # PCI hard-fail gate
tsx scripts/compliance/quarterly-access-review.ts --out review.md
tsx scripts/compliance/dr-drill.ts --out drill.md
```
