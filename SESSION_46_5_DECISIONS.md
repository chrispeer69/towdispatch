# Session 46.5 — Decision log

## D1 — ABORTED at the pre-flight hard gate (precondition unmet)

The launch brief asserts S46 (PR #128) is merged and "both implementations now
exist in master." Verified against `origin/master` @ `ac28e8a`: **S29 is on
master (PR #103, merged) but S46 is NOT — PR #128 is still OPEN.** The hard gate
"`apps/api/src/modules/marketplace-api` MUST exist on master" fails.

Per the launch's explicit failed-gate protocol ("ABORT and write
CONSOLIDATION_BLOCKED.md … Do not proceed"), I aborted the consolidation and
wrote [`CONSOLIDATION_BLOCKED.md`](./CONSOLIDATION_BLOCKED.md). Following a
documented abort protocol is not "stopping to ask" — the precondition is
genuinely unmet and proceeding would build against an unmerged, conflicting,
moving target.

**Why not proceed anyway (stack on #128 / merge both on a side branch):** S29
merged *after* the S46 branch was cut, and `git merge-tree` shows S46 conflicts
with current master (error-codes, shared index, config, app.module). A 46.5 diff
could not cleanly target master without #128 in it, and could not land before
#128 regardless. Stacking buys only review complexity + rot risk.

**Unblock:** rebase `feature/session-46-marketplace-api` onto master, resolve the
listed conflicts, merge #128 — then re-cut this branch and execute the plan in
`CONSOLIDATION_BLOCKED.md` (which is written as a ready-to-run plan: scopes,
tokens, webhooks, migration, tests, file deltas, and the two flagged
wire-contract reconciliations that must land *with* #128).

## D2 — Scope/token wire-contract reconciliations flagged, not silently shipped

The consolidation will change two wire details (scope strings `read:jobs`→
`jobs:read`; access-token format `usto_at_…`→`tc_…`). Per the launch's
STOP-and-document constraint these are flagged in the blocked doc; they are
acceptable only because #128 has no merged/GA consumers and must ship in the
same release as #128.

## Verification

`pnpm typecheck && pnpm biome check` pass — this branch is `origin/master` plus
two docs; no code touched. No regression possible.
