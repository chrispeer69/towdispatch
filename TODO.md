## Changes Log

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
