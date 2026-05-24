# Architecture Draft — Decision Log

Session: System Inventory Draft (TowCommand half of cross-app inventory).
Branch: `feature/architecture-system-inventory`. Base: `origin/master` HEAD `0715834`.
Deliverable: `docs/architecture/towcommand-system-inventory.md`.

---

## D1 — Worktree bootstrap
The launch block named worktree `/tmp/claude-worktrees/architecture-doc` on branch `feature/architecture-system-inventory`; neither existed. The active worktree was `lien-processing` (a different session, with uncommitted lien work). Per the established bootstrap pattern, created the named worktree off a fresh `origin/master` (`git worktree add -b … origin/master`) rather than contaminate the lien worktree. Verified `pwd`, `CLAUDE.md` present, branch name before writing.

## D2 — Master-HEAD is the source of truth (the central call)
The task's section headers presume a richer surface than `master` actually carries: Customer-Portal JWT (S32), Bidder JWT (S33), API-Key/public-API realm (S29), DOT/FMCSA (S37), SOC 2 Type I/II + PCI (S31/S40), fraud (S43), damage (S42). Grep confirms these have **0 module files on master** (`auction`/`marketplace`/`bidder`/`portal`/`public-api`/`fmcsa` all 0). The merge log shows the latest feature merges are #108 (heavy-duty) and #111 (EV recovery); #104/#105/#109/#110/#112 are **not** merged.
**Decision:** Document grep-verified master truth, and flag the unmerged-but-built features explicitly in §7 and §9 as "in-PR / not merged" (with PR numbers from MEMORY.md + worktree list). This honors the hard rule "DO NOT INVENT / every entity grep-verifiable" while still giving the integration team visibility into planned scope. Not presented as shipped.

## D3 — "Public-API-exposed" column reading (ambiguity resolved)
The S29 public/third-party API does not exist on master, so the column can only mean "reachable over any REST endpoint." Defaulted to that reading and stated it explicitly above the §3 table: every "yes" is an operator/driver-authenticated route, not a developer-facing API.

## D4 — API-Key realm documented as absent, not fabricated
Task §4 lists "API Key (S29)" as a realm. There is no `api_keys` table in `packages/db/sql/` and no api-key guard on master. Documented it (with Portal/Bidder) as a planned realm on an unmerged PR rather than inventing a table/guard.

## D5 — BUILD_STATUS_2026-05-17.md flagged as stale
That audit predates the merges of impound, lien (#106), multi-region (#107), heavy-duty (#108), EV recovery (#111). Its §4.9/§4.10 ("impound/lien not started") is no longer true. Cited it in §9 but qualified it as superseded; reflected current master instead.

## D6 — SOC 2 posture conservative
On master the only compliance artifacts are `docs/runbooks/security-incident.md`, `apps/api/test/security/`, and the RLS-bypass test. The `compliance.reporter.ts` under `reporting/` is an operational A/R/fleet report, not a SOC 2 controls module. Documented SOC 2 Type I/II + PCI as unmerged (S31/S40), not as shipped controls. Conservative because absent context — no controls/evidence package is grep-able on master.

## D7 — Internal events characterized as in-process, not a bus
`DISPATCH_EVENTS` (12 names, grep-verified) flow through an in-process EventEmitter → Socket.IO tenant room (Redis adapter). No durable store/outbox/cross-service bus exists. Surfaced this prominently in §6 as the single most important integration-design fact, per its relevance to the sync-vs-async boundary decision.

## D8 — Section 10 left unanswered
Per explicit instruction, the cross-app integration open questions are NOT answered. Added only TowCommand-side *constraints* under each (grep-verified facts) so the owner/Sidd/Manus have the relevant inputs, without proposing answers or designing for the other three apps.

## D9 — Migration gaps not flagged as a defect
0041/0043/0044 are absent from master (land on un-merged branches). Per MEMORY `project_migration_numbering`, `migrate.ts` re-applies idempotent SQL every run and contiguity is reconciled at merge — harmless, not a defect.

---

### Verification performed before commit
- Every §3 entity row maps to a real dir under `apps/api/src/modules/` and/or a `FORCE ROW LEVEL SECURITY` table in `packages/db/sql/`.
- Every env var named exists in `apps/api/src/config/config.schema.ts`.
- Every §6 event name matches `DISPATCH_EVENTS` in `packages/shared/src/schemas/dispatch-events.ts`.
- §10 questions left unanswered.
- No code touched outside `docs/` + this file.
