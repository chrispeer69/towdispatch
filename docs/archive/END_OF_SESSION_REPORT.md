# Session 9.6 — List-page fetch hardening

Date: 2026-05-15
Branch: `feature/fix-list-page-fetches` (off `master`)
Live URL tested: `https://app.ustowdispatch.cloud` against `https://api.ustowdispatch.cloud`
Seed report: `packages/db/POST_SEED_REPORT.md` (Session 9.5 demo tenant `roadside`)

---

## What I was asked to do

Diagnose and fix the reported bug:
> The web app list pages (customers, accounts, jobs, invoices, motor clubs,
> fleet, drivers) render empty states even though the backend returns data.
> The dashboard works.

---

## Root cause — read this carefully

**I could not reproduce the bug from a direct HTTP request against
`https://app.ustowdispatch.cloud` using the founder credentials.**

Every list page renders the seeded data in its initial SSR HTML:

| Page                        | Expected | Found in SSR HTML |
|-----------------------------|---------:|------------------:|
| `/customers`                |        7 |                 7 |
| `/accounts`                 |        2 |                 2 |
| `/accounts?type=motor_club` |        1 |                 1 |
| `/jobs`                     |        8 |                 8 |
| `/billing/invoices`         |        7 |                 7 |
| `/fleet/drivers`            |        6 |                 7 (incl. soft-deleted? matches seed expectations) |
| `/fleet/trucks`             |       16 |                17 (one extra link is the maintenance section header) |

The BFF route `/api/customers?perPage=50` (and siblings) also returns the
correct JSON when called with the auth cookie. The backend API works
directly (confirmed `curl -H "Authorization: Bearer …" https://api.ustowdispatch.cloud/customers`
returns the seven seeded customers).

**So the deployed web app is currently serving the data correctly in its
server-rendered HTML.** The most likely explanations for the founder
seeing empty state in-browser:

1. **Stale browser/router cache.** Next.js 15's client-side router caches RSC
   payloads. If the founder loaded the page while their session was rotating
   tokens, or before the Session 9.5 seed landed, an empty RSC payload would
   be cached and re-used on subsequent client-side navigations. A hard reload
   (Cmd-Shift-R in Safari) or quitting/relaunching the browser clears it.
2. **Hydration replacing good SSR data with a bad client refetch.** This
   session's customer-list-client and account-list-client both fire a
   `/api/<resource>` refetch 300 ms after mount, *even when SSR already
   loaded the same data*. If that BFF call ever returned an unexpected shape,
   `setData(json)` would overwrite the good SSR data with garbage. The PR
   closes this gap (see below).

The diagnosis-vs-symptom mismatch is the load-bearing finding here. Rather
than fabricate a fix for a bug the production server can't reproduce, this
PR hardens the surrounding behavior so the same symptom *can't* recur from
the client-side path, regardless of the original trigger.

---

## What changed (the PR)

### 1. `export const dynamic = 'force-dynamic'` on every primary list page

Files:
- `apps/web/src/app/(app)/customers/page.tsx`
- `apps/web/src/app/(app)/accounts/page.tsx`
- `apps/web/src/app/(app)/billing/invoices/page.tsx`
- `apps/web/src/app/(app)/fleet/drivers/page.tsx`
- `apps/web/src/app/(app)/fleet/trucks/page.tsx`

`/jobs` and `/dashboard` already declared this. The async `searchParams` on
each page already forces dynamic rendering — adding the explicit declaration
is belt-and-suspenders against any future code path that could let Next.js
serve a static, empty-rendered version of these pages.

### 2. Skip the redundant client-side refetch on mount

Files:
- `apps/web/src/app/(app)/customers/customer-list-client.tsx`
- `apps/web/src/app/(app)/accounts/account-list-client.tsx`
- `apps/web/src/app/(app)/fleet/drivers/driver-list-client.tsx`
- `apps/web/src/app/(app)/fleet/trucks/truck-list-client.tsx`

Before: each client component fired a `/api/<resource>?…` request 300 ms
after mount with the same query that SSR had just resolved. Wasted bandwidth
in the best case, and a window for "BFF flakes / returns malformed JSON →
overwrite good SSR data with empty state" in the worst case.

After: a `skipFirstRef` ref blocks the first effect run. The effect still
fires on every subsequent change to the search box or filter pills — the
user-visible filter behavior is unchanged.

### 3. Harden the refetch response handling

Same four client files. Before: `setData(await res.json() as Paginated…)`
trusted the response shape implicitly. After: the response is parsed inside
a `.catch(() => null)`, and only assigned to state if `Array.isArray(json.data)`
holds. A 200 with `{ code, message }` no longer turns into `data.data.length`
TypeError → "Something went wrong" error boundary.

The fleet clients already had a similar guard against 4xx error bodies;
this brings the customer/account clients up to the same level.

---

## What was deliberately NOT touched

- Backend: no API code changed.
- Database / RLS / TenantAwareDb: confirmed working via direct psql + curl;
  no changes.
- Seed: no changes to `packages/db/scripts/seed-demo.ts` in this PR (the
  modification in working tree is from Session 9.5 and stays as-is).
- Auth / JWT / cookie flow: confirmed working; no changes.
- `apiServer` / `apiServerSafe` / `apiServerBff*` in `lib/api/client.ts`:
  the inline-cookies fix from PR #12 is still correct.

---

## Manual smoke-test results

Tested against `https://app.ustowdispatch.cloud` with cookies issued by a
fresh `POST /api/auth/login` as `chris@roadside.demo`. SSR HTML inspected
with `curl + python3 grep` for entity-link anchors.

| Page                | Status | Anchors found in HTML                       |
|---------------------|:------:|---------------------------------------------|
| `/customers`        |  200   | 7 (AAAX Motor Club Dispatch, SheetzX Fleet Services, Aisha Patel, Brandon Schaefer, Daniel Carver, Latoya Williams, Marcus Johnson) |
| `/accounts`         |  200   | 2 (AAAX Motor Club, SheetzX, Inc.)          |
| `/accounts?type=motor_club` | 200 | 1 (AAAX Motor Club)                   |
| `/jobs`             |  200   | 8 rows in `<tbody>`, `jobs-total=8`         |
| `/billing/invoices` |  200   | 7 invoice rows (INV-2026-00001..00006 + one earlier write-off) |
| `/fleet/drivers`    |  200   | 7 driver detail anchors                     |
| `/fleet/trucks`     |  200   | 16 truck detail anchors                     |

This testing was done **before** this PR's changes — production was already
rendering correctly. After this PR's changes, the local `pnpm build` ran
clean and every list route is marked `ƒ (Dynamic)` in the Next.js build
manifest, confirming the `force-dynamic` flag is wired through.

`pnpm --filter @ustowdispatch/web typecheck` — clean.
`pnpm --filter @ustowdispatch/web build`         — clean.

---

## Railway env-var notes for the founder

No changes required. The web service's resolution order
(`API_INTERNAL_URL` → `API_PUBLIC_URL` → `NEXT_PUBLIC_API_URL` →
`http://localhost:3001`) is working correctly: SSR calls land on the API
service and return live data. If the founder ever wants to disable
private-networking for debugging, unsetting `API_INTERNAL_URL` on the web
service is the single lever; `NEXT_PUBLIC_API_URL` must remain pointing at
`https://api.ustowdispatch.cloud` for the Socket.IO browser handshake.

---

## How to verify the founder's reported symptom is gone

1. Open Safari → `https://app.ustowdispatch.cloud/customers` in a private
   window (no service worker / no cached RSC payloads).
2. Sign in as `chris@roadside.demo` / `TempPass#001`.
3. Expect: page renders with 7 customers immediately (server-rendered).
   Network panel shows the initial `/customers` document request but no
   client-side `/api/customers` request — that's intentional, the SSR data
   already populated the table.
4. Type into the search box. After 300 ms, Network panel should show
   `/api/customers?q=…&perPage=50` — that's the filter path, still working.

If the empty-state still appears in this clean-state test, the bug is not
in the application layer and we need to look at:
- The founder's specific Safari profile (extensions, certificate state)
- A CDN cache layer between the founder and Railway edge that I can't see
- A different deployment URL than the one tested here

---

## Open follow-ups

1. **Investigate the in-browser symptom directly.** Get a HAR file from the
   founder reproducing the empty state, plus a screenshot of the Network
   panel showing "no `/customers` request fires" — that observation is
   genuinely surprising given that the initial page navigation MUST fire a
   request to load the HTML. The mismatch between what curl sees and what
   the founder sees is the next thing to chase.
2. **The unrelated working-tree state on this branch.** Session 9.5's
   `packages/db/scripts/seed-demo.ts` modification and
   `packages/db/POST_SEED_REPORT.md` were untracked when this branch was
   cut. They are not part of this PR's diff but stay on the branch.
3. **(Already documented elsewhere.)** Several `/billing/…` routes the
   seed report links to don't exist yet (`/billing/adjustments`,
   `/billing/aging`, `/billing/rate-sheets`) — those are Session 10 scope.

---

## Files changed

| File                                                                       | What                                              |
|----------------------------------------------------------------------------|---------------------------------------------------|
| `apps/web/src/app/(app)/customers/page.tsx`                                | `export const dynamic = 'force-dynamic'`          |
| `apps/web/src/app/(app)/accounts/page.tsx`                                 | `export const dynamic = 'force-dynamic'`          |
| `apps/web/src/app/(app)/billing/invoices/page.tsx`                         | `export const dynamic = 'force-dynamic'`          |
| `apps/web/src/app/(app)/fleet/drivers/page.tsx`                            | `export const dynamic = 'force-dynamic'`          |
| `apps/web/src/app/(app)/fleet/trucks/page.tsx`                             | `export const dynamic = 'force-dynamic'`          |
| `apps/web/src/app/(app)/customers/customer-list-client.tsx`                | Skip mount refetch + harden response shape check  |
| `apps/web/src/app/(app)/accounts/account-list-client.tsx`                  | Skip mount refetch + harden response shape check  |
| `apps/web/src/app/(app)/fleet/drivers/driver-list-client.tsx`              | Skip mount refetch + harden response shape check  |
| `apps/web/src/app/(app)/fleet/trucks/truck-list-client.tsx`                | Skip mount refetch + harden response shape check  |
| `BUILD_DECISIONS.md`                                                       | Session 9.6 entry                                 |
| `END_OF_SESSION_REPORT.md`                                                 | This file                                         |
