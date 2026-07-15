## Changes Log

### 2026-07-15 — Security hardening (full-build audit follow-ups) + doc reconciliation
Full-repo audit (stack/security/features) found no critical vulns; these close the High/Medium hardening gaps it flagged. **⚠️ DEPLOY NOTE: before merging, set real values in the Railway API service for TOTP_ENCRYPTION_KEY, QBO_TOKEN_ENCRYPTION_KEY, QBO_WEBHOOK_VERIFIER_TOKEN, WEBHOOK_SIGNING_ENCRYPTION_KEY, WEBHOOK_SECRET_ENCRYPTION_KEY, SSO_TOKEN_ENCRYPTION_KEY, CUSTOMER_PORTAL_ID_ENCRYPTION_KEY, and either PAYMENTS_PROVIDER=live or PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true — otherwise the new fail-loud guards will (intentionally) fail the deploy and Railway will keep the old build serving.**
- **Fail-loud placeholder secrets (H-1):** `loadConfig` now refuses a NODE_ENV=production boot when any of the seven at-rest encryption keys / webhook verifiers still carries its repo-visible dev default (`findProductionPlaceholderSecrets`, unit-tested in `config-production-guard.spec.ts`). Files: `apps/api/src/config/config.schema.ts` (+ new spec).
- **SendGrid tier-offer webhook (H-2):** unset `SENDGRID_WEBHOOK_PUBLIC_KEY` now returns 401 in production instead of accepting unsigned events (dev/test keep the curl-friendly warn-and-accept path). File: `apps/api/src/modules/tier-offers/sendgrid-webhook.controller.ts`.
- **Payments stub guard (M-1):** production boot with `PAYMENTS_PROVIDER=stub` now throws unless `PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true` (new schema flag) — no more silently-fake payments in prod; stub webhook HMAC compare switched to `timingSafeEqual`. Files: `payments.module.ts`, `stub.provider.ts`, `config.service.ts`, `config.schema.ts`, spec extended.
- **MFA compliance drift (M-2):** `compliance/matrix.md` + `controls/cc6-logical-access.md` no longer claim blanket "MFA enforcement" — they document TOTP MFA with the `MFA_LOGIN_GATE_ENABLED` login gate (default off) and require the flag's production value as control evidence; `scripts/check-env.sh` now warns in production when the gate is off. Enforcement default deliberately NOT flipped (would force MFA enrollment on all users at next login — operator decision).
- **Mapbox diagnosability (intake/dashboard maps):** `apps/web/src/lib/geocoding.ts` now console-warns once per page load with the HTTP status when a Mapbox geocoding call fails (was fully silent). Root-cause checklist: verify `NEXT_PUBLIC_MAPBOX_TOKEN` is set to a real `pk.` token on the Railway **web** service (it's baked at build time via the Dockerfile ARG) and the token has no blocking URL restrictions; the v5 geocoding endpoint itself is confirmed alive.
- **check-env.sh:** `JWT_SECRET` (the canonical secret since the single-secret refactor) is now required in production (env-check only; `.env.example` still documents the legacy per-realm names and is off-limits per Rule 0 — add `JWT_SECRET=change-me-32+chars` there manually when convenient); legacy `JWT_ACCESS/REFRESH/MFA_SECRET` demoted to placeholder warnings; the seven encryption keys added to the placeholder-warning list.
- **Doc reconciliation:** `docs/MOAT_LIST.md` — Moat #3 (Tier Offer Composer) and #4 (Impound & Lien) corrected from queued/planned to ✅ shipped; `CLAUDE.md` — CSP location corrected (`apps/web/csp.mjs` + `next.config.mjs`, not `middleware.ts`) and the i18n rule updated to the shipped locale set (`en-US`/`en-CA`/`fr-CA`; Spanish bundle does not exist yet). Also: **correction to the 2026-07-14 CADS entry below — `feature/cads` WAS merged to master via PR #169 and is deployed.**
- Verified: api + web typecheck green; payments + config unit suites green; biome clean on touched files.
- Status: ✅ Done

---

### 2026-07-14 — CADS — pre-merge review fixes (10 confirmed issues)
Adversarial code review of `feature/cads` vs master surfaced these; all fixed before merge:
- **In-flight payload overwrite (race)**: broadcast rows now flip to a new `delivering` status while their POST is in flight, so the service layer's payload coalescing (which touches only `pending` rows) can never overwrite a payload mid-delivery and mark the wrong payload delivered. Crashed leases are re-claimed by the sweep after the 120s lease expires. Files: `packages/db/sql/0052_capacity_signaling.sql` (status CHECK), `packages/db/src/schema/capacity.ts`, `packages/shared/src/capacity/core.ts`, `apps/api/src/modules/capacity/capacity-broadcast.worker.ts`, `broadcast-log-client.tsx` (badge).
- **Lost band transitions**: the Redis published-bands map was written *before* partner fan-out, so a failed fan-out (or a cache-miss recompute, which never fanned out at all) permanently swallowed the transition. Fan-out now runs inside `recompute()` via a hook registered by `CapacityEventsListener`, and the published map only advances after a successful enqueue — failures retry on the next recompute. Files: `capacity-compute.service.ts`, `capacity-events.listener.ts`.
- **Stale-backoff coalescing**: coalescing a new payload onto a retry-scheduled row now resets `next_retry_at` to the min-interval slot and `retry_count` to 0 (a fresh state gets a fresh delivery budget, not a 2-hour-old backoff), and due coalesced rows are delivered immediately. File: `capacity-broadcast.service.ts`.
- **Dispatch board crash**: a 5xx/network failure from the new `/capacity/status` endpoint no longer takes down the whole dispatch page — the capacity fetch failure now degrades to a null panel. File: `apps/web/src/app/(app)/dispatch/page.tsx`.
- **Heavy trucks misclassed 'light'**: `createTruckSchema` no longer hard-defaults `dutyClass` to `'light'`; the API derives it from `capacityClass`/`truckType` (new shared `deriveTruckDutyClass`, mirrors the 0052 backfill) when a pre-CADS client omits it. Files: `packages/shared/src/schemas/fleet.ts`, `packages/shared/src/capacity/duty-class.ts`, `apps/api/src/modules/fleet/trucks.service.ts`.
- **Pre-existing jobs miscounted**: migration 0052 now backfills `jobs.duty_class` from the vehicle class / service type (mirrors `deriveJobDutyClass`) instead of leaving every in-flight job on the `'light'` default.
- **Override replace 500**: `createOverride` now clears *any* uncleared override for the scope (not just unexpired ones) — an expired-but-not-yet-cron-swept row occupied the partial unique index and made the insert 23505.
- **Partner PATCH 500s**: `update()` now validates webhook completeness (URL + signing secret) against the effective post-patch state and returns 400s instead of tripping the `capacity_partners_webhook_complete` CHECK; converting pull-only → webhook is rotate-secret-then-PATCH.
- **Settings overflow 500**: ratio thresholds capped at 999.999 in Zod (columns are `numeric(6,3)`).
- **Useless index / serial fan-out**: `capacity_broadcasts_pending_retry_idx` was predicated `status='failed'` (rows the sweep never reads, and which always have `next_retry_at NULL`) — now `(next_retry_at) WHERE status IN ('pending','delivering')`, and mirrored in the Drizzle schema. The sweep also delivers with a 5-wide worker pool instead of strictly serially, so one dead partner endpoint can't stall every tenant's queue behind 100×10s timeouts.
- Also: truck/job service-changed events now emit **after commit** and only on real in-service flips (were emitted mid-transaction, incl. for no-op deletes); `JobDto`/`rowToDto` now expose `dutyClass` (the reclass endpoint's response used to omit the field it had just set); `TODO(i18n)` markers added to the two CADS files missing them.
- **Test fix**: `capacity-rls.spec.ts`'s "DELETE affects zero rows" case could never pass — `app_user` has no DELETE grant anywhere (0002_roles soft-delete-only invariant), so it threw permission-denied and the aborted connection poisoned the pool (26 cascading failures). Rewritten to assert DELETE is denied outright, which is the stronger invariant. All 39 capacity tests (30 RLS + 8 integration + socket) now green against the docker stack.
- Deferred (noted, not blocking): partner pull `/v1/capacity/history` reads via `runAsAdmin` + manual tenant filter instead of the `runInTenantContext` RLS pattern public-v1 uses; override dialog hardcodes 240-min default instead of the tenant's `overrideDefaultExpiryMinutes`; capacity widget opens a second socket; `bff<T>` fetch-wrapper copy #8, unused network stub DI registrations, gauge/Th/modal duplication; offset pagination on the partner history endpoint vs the /v1 cursor helper.
- Status: ✅ Done

---

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
