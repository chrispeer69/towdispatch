# Session 31 — Decision Log: SOC 2 Type I

Date: 2026-05-24 · Branch: `feature/session-31-soc2-type1`

Decisions made autonomously (no questions per operating rules), with rationale.

## 1. TSC categories in scope for Type I

**Decision:** Security (CC1–CC9) **+ Availability (A1)**. Confidentiality,
Processing Integrity, and Privacy are **deferred to S40**.

**Rationale:** Security is the mandatory common criteria for any SOC 2. We added
Availability because the deliverables already required backup/DR evidence
(`verify-backup.ts`, BCDR policy) — the controls exist, so claiming A1 is
truthful and cheap. Confidentiality/PI/Privacy require additional controls
(data-flow classification enforcement, output validation attestations, privacy
notices) that are real work, not paperwork; scoping them in now would be a claim
we can't yet evidence. Better a narrow, defensible Type I than a broad, soft one.

## 2. Auditor

**Decision:** Auditor **TBD** — not yet engaged. Artifacts are structured to be
auditor-agnostic (Vanta/Drata/Secureframe-importable: one control file per TSC,
a control→evidence→owner matrix, scripted evidence collectors).

**Rationale:** Engaging a CPA firm is a business/procurement decision outside an
engineering session. The work here is the prerequisite either way.

## 3. Audit-log retention: 7 years

**Decision:** 7-year retention for `audit_log`, documented in the Security and
Data-Classification policies. The append-only table is the system of record.

**Rationale:** Covers the longest realistic SOC 2 Type II observation window plus
typical financial/legal investigation horizons. A hard-purge `app_admin` job that
enforces the window is **not yet deployed** — flagged as a follow-up. The table is
append-only and small relative to operational data, so retention is met by
default today; nothing is being deleted prematurely.

## 4. "Filter by tenant" → always the caller's own tenant (RLS)

**Decision:** `GET /admin/audit-log` runs inside the caller's tenant transaction;
RLS confines results to that tenant. There is **no cross-tenant filter**.

**Rationale:** Cross-tenant audit access would require a platform-superadmin role
that does not exist in the seven-role model, and minting one would itself be a new
attack surface and a tenant-isolation risk (the #1 risk in our threat model).
Keeping the reader tenant-scoped preserves the "RLS is sacred" invariant. A future
platform-ops console is the right home for cross-tenant audit access (deferred).

## 5. Secret redaction in the audit reader (blocker, fixed)

**Decision:** Strip every field whose name ends in `_hash` or contains
`secret`/`password` from `before_state`/`after_state` before the API returns
them (`apps/api/src/modules/admin/audit-redaction.ts`), with a unit test
asserting `password_hash` never appears.

**Rationale:** `audit_log` snapshots are full `to_jsonb(row)` blobs that include
`users.password_hash`, `mfa_secret_encrypted`, and the `*_tokens` hashes.
Returning them verbatim would make the audit reader leak the very secrets this
control exists to protect — the control would fail its own evidence. A
name-based denylist is safe-by-default and needs no allowlist to maintain.

## 6. Audit-trigger backfill: add 4, exclude 6 (documented)

**Decision:** Audit of `packages/db/sql/` found 66 tenant tables already
triggered. Migration `0037` adds triggers to `invoice_taxes`, `job_ratings`,
`tenant_default_rate_sheets`, `tracking_messages`. Six tables remain
intentionally un-audited (telemetry stream, the append-only
`job_status_transitions` log, the two number-sequence counters, `sessions`,
`stripe_events`).

**Rationale:** See `compliance/controls/audit-logging.md` and the `0037` header
(same text in both places, by design). `sessions` and `stripe_events` are
excluded specifically to honor the session boundary "do not modify auth flows /
do not touch Stripe (PCI is S40)."

## 7. Evidence scripts: `pg` added to root devDependencies

**Decision:** Added `pg` + `@types/pg` to root `devDependencies` so the literal
`scripts/compliance/*.ts` path from the spec resolves `pg` under `tsx`.

**Rationale:** Root `scripts/` is not a workspace; pnpm strict linking won't hoist
`pg` from a sub-package. Adding it to root (matching the existing
`scripts/railway-start.mjs` precedent) was the conforming choice over relocating
the scripts into `apps/api`.

## 8. `compliance:check` exit semantics: WARN/SKIP non-fatal, FAIL fatal

**Decision:** The smoke test fails (exit 1) only on a structural evidence gap
(missing control/policy, control absent from `matrix.md`) or a collector hard
failure. Missing credentials (no DB / no `gh` auth / no backup source) → SKIP;
a reachable-but-unmet control (e.g. `master` not yet protected) → WARN. Both are
non-fatal. Collectors take `--strict` to flip WARN→FAIL for CI/auditor runs.

**Rationale:** Honors the operating rule "missing credential → skip, document,
continue." Keeps `pnpm compliance:check` green in a credential-less environment
while still surfacing real gaps loudly. The current run reports
`master` has no branch protection (WARN) — a genuine, visible gap to close in
GitHub settings; it does not block the build.

## 9. Web audit-log viewer is English-only

**Decision:** The `/admin/audit-log` page ships English-only, no `// TODO(i18n)`
spread through it.

**Rationale:** The web app has **no i18n framework** (no next-intl); every
existing page is English-only. Mirroring existing code (operating rule #9) beats
inventing an i18n layer for one internal admin/auditor tool. Revisit if/when the
app adopts i18n broadly.

## Deferred to S40 (Type II + PCI)

- SOC 2 **Type II** evidence over an observation period (operating-effectiveness).
- **PCI DSS** assessment (Stripe surface untouched this session).
- Confidentiality / Processing Integrity / Privacy TSC.
- `audit_log` hard-purge retention job (enforce the 7-year window).
- Platform-ops cross-tenant audit console (superadmin role + its own controls).
- Wire `verify-branch-protection`/`verify-backup` `--strict` into CI; configure
  `BACKUP_STATUS_URL` so backup recency is continuously asserted.
- WAL archiving / PITR to drop RPO from 24h to ~5min (per `ARCHITECTURE.md §11`).
