## Changes Log

### 2026-07-14 — CADS — engine, delivery surfaces, seeds, tests, docs
- Capacity API module (`apps/api/src/modules/capacity/`): pure math core (ratio/weights/band mapping/hysteresis+dwell/override precedence — unit-tested), event-driven compute service (Redis-cached state + snapshot persistence on band transitions / 5-min steady state), per-tenant debounced recompute listener on job/shift/driver/truck events, once-a-minute cron for override expiry + broadcast retries.
- Delivery: HMAC-signed outbound webhooks (same `X-TowCommand-Signature` scheme as the public API, retry ladder → dead_letter, SSRF guard with DNS re-check per attempt), partner pull API `GET /v1/capacity` + `/v1/capacity/history` (per-partner keys, 60/min rate limit, class-visibility scoping), `CapacitySignalAdapter` + generic webhook impl + agero/nsd/urgently stubs.
- Wiring: `truck.service_changed` now emitted by fleet TrucksService; jobs derive `duty_class` at intake (`deriveJobDutyClass`) with a dispatch reclass endpoint `POST /jobs/:id/duty-class` + `job.duty_class_changed` event.
- Seeds: dev seed gives trucks duty classes (heavy rotator on T-x-03), seeds capacity_settings defaults + a demo webhook partner pointed at `http://localhost:4010/cads-echo` with fixed dev credentials; demo seed trucks map capacity→duty and set `is_rotator`.
- Tests: 36 unit (math + SSRF guard), 30 RLS isolation across all five capacity tables (`apps/api/test/capacity-rls.spec.ts`), 8 integration (event-driven recompute, override precedence, signed webhook verified end-to-end, retry→dead_letter, pull API auth/scoping/rate-limit/rotation, SSRF rejection), CADS socket tenant-isolation spec, Playwright `e2e-013-capacity-signaling`.
- Fix: `apps/api/vitest.config.ts` aliases now use `fileURLToPath` (Windows checkouts with spaces in the path could not resolve `@ustowdispatch/*` in tests).
- Docs: `docs/cads.md` (payload schema v1.0, partner signature-verification sample, settings reference) + `docs/cads-walkthrough.md` (manual browser script).
- Verified: fresh-DB migration run clean (64 applied, incl. 0052); typecheck green for shared/db/api/web; all capacity unit + RLS + integration + socket suites green locally against the docker stack.
- Status: ✅ Done (feature branch `feature/cads`, not merged)

---

### 2026-07-14 — CADS — web UI (dispatch widget, settings page, broadcast log)
- Dispatch board now shows a "Capacity Signal" panel: blended status first, per-class gauges (light/medium/heavy) with ratio + colored band pill + drivers/jobs counts, override banner with clear action, "Set override" dialog, and last-broadcast stamp. Live via the `capacity.status_changed` socket event (own connection through the existing `/api/socket/token` handshake so `useDispatchBoard` — shared with /assign-jobs — is untouched).
- New settings tab **Capacity Signaling** at `/settings/capacity`: band thresholds (strictly-increasing check via shared `assertBandsOrdered`) + hysteresis/broadcast tuning, job-weights table, partner registry (add/enable/pause/rotate secret & API key/test-fire/delete; credentials shown once in a copy-now modal), active-overrides section, link to the broadcast log.
- Broadcast log at `/settings/capacity/broadcasts`: partner + status filters, pagination, payload viewer modal.
- Files added: `apps/web/src/lib/api/capacity.ts`, `apps/web/src/lib/api/capacity-client.ts`, `apps/web/src/app/api/capacity/[...path]/route.ts` (BFF proxy), `apps/web/src/components/capacity/capacity-shared.tsx`, `apps/web/src/app/(app)/dispatch/capacity-signal.tsx`, `apps/web/src/app/(app)/settings/capacity/{page.tsx,capacity-settings-client.tsx}`, `apps/web/src/app/(app)/settings/capacity/broadcasts/{page.tsx,broadcast-log-client.tsx}`.
- Files modified: `apps/web/src/app/(app)/settings/tabs.ts` (new tab), `apps/web/src/app/(app)/dispatch/page.tsx` + `dispatch-client.tsx` (fetch + render the widget).
- Verified: `pnpm --filter @ustowdispatch/web typecheck` passes; biome lint clean on all touched files.
- Status: ✅ Done

---

### 2026-07-14 — CADS (Capacity-Aware Dispatch Signaling) — data layer [IN PROGRESS]
- New flagship feature: continuously computes live dispatch load per duty class (light/medium/heavy) and broadcasts machine-readable availability to motor-club partners. This commit lays the data + contracts foundation; API module, delivery surfaces, web UI, and tests follow on this branch.
- Migration `packages/db/sql/0052_capacity_signaling.sql`: five new tenant tables (`capacity_settings`, `capacity_snapshots`, `capacity_overrides`, `capacity_partners`, `capacity_broadcasts`) — all FORCE RLS + audit triggers + soft delete, matching 0045 patterns. Adds `trucks.duty_class` (NOT NULL default 'light', backfilled from `capacity_class`/`truck_type`), `trucks.is_rotator` (backfilled from equipment array), `jobs.duty_class` (settable, default 'light').
- Drizzle schema: new `packages/db/src/schema/capacity.ts`; `trucks.ts`/`jobs.ts` gained the new columns; registered in `schema/index.ts`.
- Shared contracts: new `packages/shared/src/capacity/` (bands, settings, status, overrides, partners, broadcasts, partner-facing payload v1.0). New dispatch events `truck.service_changed` + `capacity.status_changed`; three new error codes.
- Verified: `pnpm typecheck` passes for db, shared, api.
- Status: 🟡 Partial (data layer done; feature continues on `feature/cads`)

---

### 2026-06-09 — Dispatch board: collapsible sidebar + taller map
- Live Dispatch readability: the left nav now auto-collapses to a narrow icon rail when on `/dispatch` (and auto-expands elsewhere), giving the dense dispatch tiles + map the full board width. Manual toggle button added (PanelLeftClose/Open); main content is `flex-1`, so the rail shrinking widens the board.
- Dispatch map panel height increased 420px → 640px (placeholder min-height matched) for a more usable map.
- Files modified: `apps/web/src/components/app-shell/sidebar.tsx`, `apps/web/src/app/(app)/dispatch/dispatch-map.tsx`.
- Verified: `pnpm --filter @ustowdispatch/web typecheck` passes.
- Status: ✅ Done

### 2026-06-09 — Normalize brand to "US Tow Dispatch"
- Standardized all user-facing brand text to **US Tow Dispatch** across the web app, API, and docs.
- Replacements applied: `US Tow DISPATCH`/`US TOW DISPATCH` → `US Tow Dispatch`; `Tow Command` → `US Tow Dispatch`; `towcommand.cloud` → `ustowdispatch.cloud`; display strings (page titles, email sender/footer, push titles) `TowCommand`/`TowCommand Pro` → `US Tow Dispatch`/`US Tow Dispatch Pro`.
- Files modified: 248 (web pages, API config/notifications templates, docs). Examples: `apps/web/src/app/(app)/**/page.tsx`, `apps/api/src/config/config.schema.ts`, `apps/api/src/modules/notifications/templates/system-templates.ts`.
- Deliberately NOT changed (would break things / Rule 0): webhook headers `X-TowCommand-*` and `TowCommand-Webhook` UA (public API contract), `towcommand_id`/`towcommandId` (frozen migration column), `towcommand_jobs_*` (queue names), iOS `TowCommandDriver` project (structural rename, deferred), and all forbidden files (`.env*`, `railway.toml`, `docker-compose.yml`, `packages/db/sql/*`, `scripts/deploy.sh`, `apps/api/src/modules/auth/*`).
- Identifiers `@ustowdispatch` / `ustowdispatch` / `UsTowDispatch` left as-is (already correct).
- Verified: `pnpm typecheck` passes for web, api, shared, db.
- Status: ✅ Done

---
- Mapbox token broken on dashboard/intake — investigate later.
