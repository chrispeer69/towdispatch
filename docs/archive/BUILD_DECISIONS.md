# BUILD_DECISIONS

Append-only log of non-obvious calls made by Claude during Session 9.5+ work. Each entry: what was decided, why, and where to look.

---

## Session 9.5 — demo tenant seed (`feature/seed-demo`)

### 1. Package name in scripts: `@ustowdispatch/db`, not `@towcommand/db`

The session prompt referred to `pnpm --filter @towcommand/db build`. The actual workspace package is `@ustowdispatch/db` (see `packages/db/package.json`). Used the real name throughout the new scripts and README.

### 2. Slug = subdomain

`tenants` has no `subdomain` column. `tenants.slug` is the established convention (the existing seed uses it the same way). Set `slug='roadside'` and treat that as the demo subdomain.

### 3. Tenant address / phone / logo → `tenants.settings`

`tenants` has no top-level columns for address, phone, or logo. These live in the `settings` jsonb. Shape:

```jsonc
{
  "brand": { "logoUrl": "https://placehold.co/..." },
  "contact": { "address": { ... }, "phone": "...", "billingEmail": "..." }
}
```

If/when the schema grows real columns, lift these out of `settings` in a follow-up migration.

### 4. `accounting_integration_status` → `tenants.settings.accounting`

Same reason. Shape: `{ integrationStatus: 'disconnected', provider: null }`. The QBO module reads its real connection state from `accounting_connections`; the settings block is for the UI badge.

### 5. Yards live in `tenants.settings.yards`

`packages/db/src/schema/drivers.ts` calls out `assignedYardId` as a "forward FK to locations(id) — Session 9 stub" with no FK constraint enforced. There is no `locations` / `yards` / `garages` table yet. Decision:

- Store the two yards as `{ id, name, address }` records in `tenants.settings.yards`.
- Use those UUIDs in `drivers.assignedYardId` (the column accepts any UUID).
- `trucks` has no yard column at all; trucks reference their yard in `trucks.notes` plus a `tenants.settings.truckYardAssignments` (`unit → yardId`) map.

When the `locations` table ships, write a migration that:

1. Inserts a `locations` row for each `tenants.settings.yards[]` entry, reusing the existing UUIDs.
2. Adds the FK constraint on `drivers.assignedYardId`.

### 6. `customers.referral_source` — SQL-only migration, no Drizzle migration file

The session prompt asked for "Drizzle migration + matching SQL migration". The existing repo pattern (cf. `packages/db/sql/0009_customers_extended_contact.sql`) adds plain columns through the SQL pass alone and only updates the Drizzle TS schema. The Drizzle migrations folder + meta snapshots stops at `0011_chat` and the SQL folder runs through `0020_mfa`; trying to inject a hand-rolled Drizzle migration without `drizzle-kit generate` would require re-writing `_journal.json` and the snapshot files, which is fragile.

Decision: file the column under `packages/db/sql/0021_customers_referral_source.sql` (the established pattern) and update `packages/db/src/schema/customers.ts` so the type system knows about the column. The seed reads / writes through the typed schema.

### 7. `users.must_change_password` does not exist — use `lastLoginAt IS NULL`

The prompt asked for `must_change_password=true` on every seeded user. There is no such column on `users`. The existing app convention for new accounts is `lastLoginAt IS NULL → force password rotation on first login`. The seed leaves `lastLoginAt` unset on every user, which falls into the existing flow.

If a real `must_change_password` boolean ships later, swap the seed over to populate it.

### 8. Customer "billing_type" and "payment_terms" live on `accounts`, not `customers`

The prompt asked for `customers.billing_type = motor_club_account / commercial_account / cash` and a `payment_terms` field on customers. The actual schema has `customers.type` (`cash | account` only) and `customers.accountId → accounts.id`. `payment_terms` lives on `accounts.billingTerms`.

Decision: model AAAX and SheetzX as `accounts` rows (motor club + commercial respectively) and link a `customers` row of `type='account'` to each. Cash customers (Marcus + the others) are `customers.type='cash'`.

This preserves correct billing behavior — the rate engine, invoice generator, and A/R logic all hang off accounts, not customers.

### 9. Rate sheet "scope" expressed via `accounts.defaultRateSheetId`

The prompt asked for rate sheets with a `scope` (tenant vs customer). `rate_sheets` has no scope column. The schema's intended model is:

- One default rate sheet via `tenant_default_rate_sheets`.
- Account-level overrides via `accounts.defaultRateSheetId`.
- Customer-level overrides via `customers.defaultRateSheetId`.

AAAX and SheetzX get their own rate sheets, set on both `accounts.defaultRateSheetId` AND `customers.defaultRateSheetId` for the linked dispatch-contact customer.

### 10. 25% after-hours surcharge cannot be expressed in `rateSheetDefinitionSchema`

`packages/shared/src/schemas/rate-sheet.ts surchargeWindowSchema` only supports `amountCents` (fixed). The Default Retail and SheetzX rate sheets carry a placeholder surcharge entry (`amountCents=0`, label flagged as "applied at invoice"). The policy itself lives in `tenants.settings.billingPolicies.afterHoursSurchargePct=25`.

When the rate engine learns percentage surcharges, migrate this field into `surchargeWindowSchema`.

### 11. Tax rates live in `tenants.settings.taxRates` (no tax_rates table)

There is no standalone `tax_rates` table. Tax is captured per-invoice on `invoice_taxes` + `invoice_line_items.taxRatePct`. The tenant-level configuration (OH 5.75% state + Franklin County 1.5%, plus the list of taxable / non-taxable line types) lives in `tenants.settings`.

### 12. `invoices.pdf_s3_key` does not exist

The prompt asked us to populate `pdf_s3_key` "if the column exists". It does not. Invoices that would carry a PDF placeholder get a `notes` line saying so. When the column ships, populate it from those invoices on a follow-up migration.

### 13. Adjustments / write-offs use `payments.paymentMethod='write_off'`

There is no `invoice_adjustments` table. The schema has `credit_memos`, but its `reasonCode` enum doesn't include `write_off`. The clean path is `payments` with `paymentMethod='write_off'` and `referenceNumber` + `notes` carrying the policy context. This brings `paidCents` up to `totalCents` and `balance = 0`, with `status='paid'`.

The `/billing/adjustments?kind=write_off` UI route can filter on `payments.paymentMethod='write_off'`.

### 14. Invoice numbering: ROAD-2026-NNNNN via `invoice_number_sequences`

The schema uses `(tenant_id, year_key) → last_seq` with `UPSERT + UPDATE … RETURNING`. Allocation is atomic. Each invoice gets the next `ROAD-2026-NNNNN` number on insert.

### 15. Production safety = explicit env var + explicit URL var

`--target=production` requires `SEED_DEMO_CONFIRM=YES_I_AM_SURE`. The connection URL is taken from `PRODUCTION_DATABASE_ADMIN_URL` (preferred) or `DATABASE_ADMIN_URL` (fallback). The seed does not read `.env.example` and does not log the URL. Two-factor: knowing the variable name + having the value.

### 16. `--reset` is the only data-destruction path

Even on `--target=local`, the seed does not `DROP SCHEMA`. The existing `pnpm db:reset` already does that. `--reset` is scoped to the demo tenant: every child table is cleared in FK-safe order, then the `tenants` row is dropped. Side benefit: a future "seed two demo tenants" extension can target one tenant without touching the other.

---

## Session 9.6 — list-page fetch hardening (`feature/fix-list-page-fetches`)

### 17. Reported bug ("list pages render empty") could not be reproduced

Production at `https://app.ustowdispatch.cloud` was already SSR-rendering the
correct 7 customers / 2 accounts / 8 jobs / 7 invoices when fetched with
`curl + chris@roadside.demo cookies`. Tested against the live deployment;
HTML included the entity rows. The BFF route handlers (`/api/customers`,
`/api/accounts`, etc.) also returned correct JSON. Bug is therefore likely
either a stale browser/router-cache state on the founder's end OR a latent
window where the on-mount client refetch overwrites good SSR data — we
hardened against the second and documented the first.

### 18. `dynamic = 'force-dynamic'` is now belt-and-suspenders on every list page

`searchParams: Promise<…>` already forces dynamic rendering. The explicit
declaration is in place anyway so a future refactor that drops `searchParams`
(e.g. switching to client-only filters) can't accidentally re-enable static
caching of these authenticated pages.

### 19. Client list components skip the first useEffect run

The customer/account/driver/truck list clients used to refetch their data
300 ms after mount even though SSR had just resolved the same query. A
`skipFirstRef` ref now blocks the first effect run. Behavioral consequence:
the initial `/customers` page load makes **no** browser-visible
`/api/customers` request. The first such request fires only after the user
types in the search box or clicks a filter pill — which is the only time
the client state and SSR state can actually diverge.

### 20. Refetch state-update is shape-guarded

`setData(await res.json() as Paginated…)` now goes through a `.catch(() =>
null)` JSON parse and an `Array.isArray(json.data)` check before applying.
A 200 with `{ code, message }` no longer corrupts state into a
`data.data.length` TypeError on the next render.

---

## Session 9.7 — list-pages-empty root cause: page-level `cookies()` returns empty store (`fix/cookie-via-header-9.7`)

### 21. Root cause: `cookies()` request scope is lost between `(app)/layout.tsx` and the page render in Next.js 15 production builds

Production diagnostics showed the same request producing two different
results from `cookies()`:

```
[diag-list-empty]    { path: '/auth/me', hasAuth: true }     ← layout: cookie present
[diag-page-cookies]  { hasToken: false, cookieNames: [] }    ← page:   empty store
```

`requireUser()` inside `(app)/layout.tsx` reads the access cookie correctly
and calls `/auth/me` with the bearer; the very next module — the page
component — calls `cookies()` and gets back an empty store. The cookie is
on the request (the browser sent it, the layout saw it), but Next 15's
dynamic-API request scope does not propagate to the page module in
optimized production builds. Earlier sessions misdiagnosed this as a
fetcher-boundary problem (Session 9.6 #19/#20) and as a cookie-domain
problem (`fix/web-cookie-domain-towcommand-cloud`) — both were real but
neither was the actual cause of the empty list pages.

### 22. Fix: read the cookie from the raw request header via `headers()`

`headers().get('cookie')` returns the verbatim `Cookie:` request header,
which is request-bound the same way `cookies()` is *supposed* to be but
empirically isn't. Parsing `tc_at=…` out of that string at the page level
gets the token through reliably. Pattern:

```ts
import { cookies, headers } from 'next/headers';

const cookieHeader = (await headers()).get('cookie') ?? '';
const token =
  cookieHeader
    .split(/;\s*/)
    .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1) ?? null;
```

The token is then threaded into `fetchCustomers(params, token)` exactly
the same way Session 9.6 wired it — only the *source* of the token
changed, not the plumbing.

### 23. Rollout scope is the SSR list pages, not every server component

This affects pages that read the access cookie at render time to call the
BFF with an `Authorization` header. Apply to: `/customers`, `/accounts`,
`/billing/invoices`, `/jobs`, `/fleet/drivers`, `/fleet/trucks`. Server
components that don't read the cookie themselves (they go through middleware
or a route handler) are unaffected. `(app)/layout.tsx` keeps using
`cookies()` directly — that call works; the failure is only on the second
invocation in the same request.

### 24. `[diag-page-cookies]` log stays in place until the fix is verified

The log now reports `hasToken`, `cookieNames` (from the broken `cookies()`
call), and `headerHasCookie` (from the new `headers()` read). After deploy
we expect `headerHasCookie: true, hasToken: true, cookieNames: []` — that
combination both confirms the fix and keeps the original symptom visible
so we don't lose the evidence trail. Remove the log only after the
rollout to the other five pages is confirmed working.
