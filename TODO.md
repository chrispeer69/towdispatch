## Changes Log

### 2026-06-09 — Fix: Repo Cases tab crashed when the module is disabled
- Root cause: the repossession module ships dark behind the API's `REPO_MODULE_ENABLED` flag (default off) → every `/repo-cases` + `/lienholders` route returns `503 repo_module_disabled`. The `/repo/*` web pages only handled 403, so the 503 (a 5xx) bubbled through `tryFetch` to the route error boundary → blank "broken" page.
- Fix: `/repo/*` pages now catch the disabled (503) and forbidden (403) states and render a calm explainer via a new shared `RepoUnavailable` component, instead of crashing. Detail page still 404s an unknown id.
- To actually turn the feature ON, set `REPO_MODULE_ENABLED=true` on the API service (Railway env) — that is an env/ops change, not code.
- Files: `apps/web/src/app/(app)/repo/repo-unavailable.tsx` (new), `repo/cases/page.tsx`, `repo/lienholders/page.tsx`, `repo/cases/new/page.tsx`, `repo/cases/[id]/page.tsx`.
- Verified: web typecheck passes; against a module-off stack, `/repo/cases`, `/repo/lienholders`, `/repo/cases/new` all return 200 with the explainer (no crash).
- Status: ✅ Done

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
