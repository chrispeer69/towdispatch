# Session 56 — Dispatch Board Layout Overhaul — BLOCKED

**Status:** 🛑 ABORTED at the pre-flight gate. Not started. `origin/master` does not compile.
**Date:** 2026-05-24 · **Branch:** `feature/session-56-dispatch-layout` (off `origin/master` @ `13439ba`)

The Session 56 launch brief's PRE-FLIGHT GATE states verbatim: *"origin/master MUST compile (pnpm typecheck exit 0). If not, ABORT and write LAYOUT_BLOCKED.md noting master-corruption status. Do not proceed on broken master."* That condition is not met. This file is that artifact.

## Pre-flight gate results

| Gate | Result |
|---|---|
| `origin/master` compiles (`pnpm typecheck` exit 0) | ❌ **FAIL** — see below |
| dispatch board route exists | ✅ `apps/web/src/app/(app)/dispatch/` (page.tsx, dispatch-client.tsx, dispatch-map.tsx, dispatch-state.ts) |
| Mapbox is the current map provider | ✅ `apps/web/src` references `NEXT_PUBLIC_MAPBOX_TOKEN` / mapbox-gl |

Only the first gate matters, and it fails hard.

## Why the gate fails — concrete evidence

`origin/master` is still `13439ba` ("Merge PR #129 enterprise-sso"); the documented corruption (see memory `project_master_broken_pr129`) is unrepaired on master. Neither PR #132 (Session 50 repair) nor PR #134 (Session 54 `chore(base)` repair) has been merged.

**6 files carry literal Git conflict markers** (`<<<<<<<` / `=======` / `>>>>>>>`) — these are syntax errors; `tsc` and `swc` cannot parse them, so `pnpm typecheck` is guaranteed non-zero without even installing:
- `apps/api/src/config/config.schema.ts`, `apps/api/src/config/config.service.ts`, `apps/api/src/app.module.ts`
- `packages/shared/src/constants/error-codes.ts`, `packages/db/src/schema/index.ts`
- `apps/web/src/app/(app)/settings/tabs.ts`

Plus pervasive content corruption (stripped `/**` openers, relocated blocks) in `apps/api` (`admin/*`, `auth/jwt.service.ts`) and `apps/web`.

## Why a LAYOUT session specifically cannot proceed (even self-contained)

Session 50 (backend) was able to build self-contained on this broken master because its logic is unit-testable in isolation. **A dispatch-board visual overhaul cannot**, for two hard reasons rooted in the corruption:

1. **`apps/web/next.config.mjs` has THREE competing `export default`** (lines 51, 61, 77: sentry-only, next-intl-only, sentry-with-options). `next build` and `next dev` both fail to load the config → **the web app cannot be built or served**. The brief's verification explicitly requires *"Open localhost dispatch board at all 3 breakpoints and confirm…"* — impossible on a base where `next dev` won't boot. A layout shipped without being rendered once is unverifiable and not done (CLAUDE.md Rule 10).
2. **`apps/web/src/components/app-shell/sidebar.tsx` is corrupted** (duplicate-key nav object — the same defect that blocked Session 50 from wiring its nav link). Deliverable #10 (collapsible sidebar) edits this exact file. Building the collapse behavior on top of an already-broken sidebar would compound corruption in the file I must own.

Proceeding would produce a large, unverifiable, unmergeable diff stacked on a base that three sessions are already independently trying to repair (#132, #134) — the opposite of the conservative path.

## Remedy — how to unblock (then re-launch Session 56 unchanged)

Pick one, in preference order:

1. **Merge PR #134** (Session 54) to master — per memory it "independently re-repaired the whole base in a `chore(base)` commit," and is the most complete web repair (covers `next.config.mjs`, sidebar, sentry, etc.).
2. **Merge PR #132** (Session 50) — repairs the conflict markers + `shared`/`db` collisions, but did NOT touch `apps/web/next.config.mjs`, so confirm the web build separately.
3. If neither can merge soon, cherry-pick the `chore(base)` repair commit from PR #134 onto master (or onto this branch as a first commit) and re-run the gate.

**Resume condition:** when `origin/master` satisfies `pnpm typecheck` (exit 0) **and** `pnpm --filter @ustowdispatch/web build` succeeds, re-launch Session 56 with the same brief. All 13 deliverables are unstarted; nothing here needs reworking.

## What was done this session

- Created the worktree + branch, ran the full pre-flight gate, captured the evidence above, wrote this file. **No deliverable code was written** (no map-style swap, no layout, no `user_ui_preferences` migration, no drawers/tickers/cards). The migration number (next sequential after 0051–0054 — note 0051 is now used by several parallel sessions) is to be re-checked at resume.

## What was NOT touched

The assignment API, jobs state machine, the existing dispatch board, the driver app — none modified (the brief's DO-NOT list is moot since nothing was built).
