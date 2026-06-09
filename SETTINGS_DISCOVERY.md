# Settings Discovery — 8-tab admin nav

Discovery pass for the upcoming `/settings` shell. For each of the 8 tabs
the table below records what exists today across `apps/web`, `apps/api`,
and `packages/db`. **Status** is one of:

- **FULLY BUILT** — route + UI + API + DB all wired and shipping
- **PARTIALLY BUILT** — some layers exist (usually backend/DB); UI missing
- **NOT BUILT** — no relevant code found

## Discovery table

| # | Tab | Routes (apps/web) | Components (apps/web) | API (apps/api/src/modules) | DB / Drizzle (packages/db/src/schema) | Types / DTOs | Status | What works today |
|---|---|---|---|---|---|---|---|---|
| 1 | **Company Profile** | _none_ | _none_ | `tenants/tenants.controller.ts` exposes `GET /tenants/current` and `PATCH /tenants/current` (name + arbitrary `settings` jsonb); `tenants/tenants.service.ts` | `tenants.ts` — `tenants` table (id, slug, name, status, `settings` jsonb, Stripe Connect fields, `platformMarginBps`, timestamps) | `packages/shared/src/schemas/tenant.ts` — `tenantSchema`, `TenantDto`, `tenantSlugSchema`; `auth.ts` — `authTenantDtoSchema` | **PARTIALLY BUILT** | Read/update of the caller's tenant works via the REST API. No UI surface to edit company name or settings exists. |
| 2 | **Services & Pricing** | _none_ | _none_ | `rates/rate-engine.service.ts` (internal only — no HTTP controller); `rates/rates.module.ts` exports the service for invoice/intake flows | `rate-sheets.ts` — `rateSheets` table (jsonb `definition`) + `tenantDefaultRateSheets` table (per-tenant default) | `@towdispatch/shared` exports `rateSheetDefinitionSchema`, `RateSheetDefinition`, `JobServiceType`, `VehicleClass`, `RateLineItem`, `RateQuote`, `SurchargeWindow` | **PARTIALLY BUILT** | The rate engine consumes a rate sheet at quote time and falls back to a hard-coded definition. No CRUD endpoints, no UI for creating/editing rate sheets. |
| 3 | **Account Rate Cards** | _none_ | _none_ | `accounts/accounts.controller.ts` `PATCH /accounts/:id` accepts `defaultRateSheetId` updates via `updateAccountSchema`; `rates/rate-engine.service.ts` resolves account-level rate sheets first | `accounts.ts` — `accounts.defaultRateSheetId` column (uuid, nullable); resolution logic uses it | `updateAccountSchema`, `AccountDto`, `UpdateAccountPayload` in `@towdispatch/shared` | **PARTIALLY BUILT** | The DB column exists; the rate engine consumes it; the account update payload accepts it. No UI field in `accounts/account-form.tsx` exposes it, and no per-account rate-card management screen exists. |
| 4 | **Tax & Fees** | _none_ | _none_ | `billing/billing-line-items.ts` defines `DEFAULT_TAX_RATE = '0'` and translates rate-engine output into per-line `taxable` / `taxRatePct`; `billing/invoices.service.ts` calculates and persists `invoice_taxes` rows on issue | `invoices.ts` — `invoice_line_items.taxable`/`taxRatePct` columns; `invoice_taxes` table (jurisdiction, name, ratePct, taxable/tax amount cents) | Per-line types via `invoiceLineItemTypeValues`; tax types come back through the invoice DTO. No tenant-level tax config DTO. | **PARTIALLY BUILT** | Tax storage on invoices works end-to-end (engine → line items → invoice taxes → PDF). There is no tenant-wide tax configuration table or endpoint — tax rate is plumbed per call site with a hard-coded `'0'` default. |
| 5 | **Invoice Defaults** | _none_ | _none_ | `billing/invoices.service.ts` hard-codes terms / number sequence policy; `tenants.settings` (jsonb) is the implicit catch-all for tenant-wide knobs but is unused for invoice defaults today | `invoices.ts` — `invoices.terms` enum (default `'net_30'`); `invoice_number_sequences` allocator per tenant/year. No `tenant_invoice_settings` table. | `invoiceTermsValues` enum in shared; no "invoice defaults" DTO | **NOT BUILT** | Defaults exist only as column defaults / hard-coded constants. No dedicated settings surface (DB, API, or UI) for terms, footer text, payment instructions, number prefix, etc. |
| 6 | **Users & Permissions** | _none_ | _none_ | `users/users.controller.ts` — `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` (deactivate); `auth/auth.service.ts` + `common/guards/roles.guard.js` + `common/decorators/roles.decorator.js` enforce role checks | `users.ts` — `users` table with `userRoles` enum (`owner`, `admin`, `manager`, `dispatcher`, `driver`, `accounting`, `auditor`), MFA fields, lockout fields | `@towdispatch/shared` — `ROLES`, `UserDto`, `CreateUserPayload`, `UpdateUserPayload`, `createUserSchema`, `updateUserSchema` | **PARTIALLY BUILT** | Full backend: list, create, update, deactivate, role enforcement on guarded routes. No UI (no `/users`, no `/settings/users`). No "invites" flow — users are created directly with a password; invite tokens are not modeled. |
| 7 | **Notifications** | _none_ | _none_ | `email/email.service.ts` and various per-feature emitters (chat, tracking, accounting webhooks) but no central notification settings service | _none_ — no `notifications` or `notification_preferences` table | _none_ | **NOT BUILT** | Transactional emails / event emitters exist per feature; there is no concept of per-tenant or per-user notification preferences. |
| 8 | **Billing & Subscription** (tenant-side) | `billing/payments-settings/page.tsx` + `payments-settings-client.tsx` (Stripe Connect onboarding + `platformMarginBps`) | `billing/payments-settings/payments-settings-client.tsx` | `payments/payments.controller.ts` — `GET /payments/connect/status`, `POST /payments/connect/start`, `POST /payments/connect/sync`, `PUT /payments/connect/margin` | `tenants.stripeAccountId`, `tenants.stripeAccountStatus`, `tenants.stripeChargesEnabled`, `tenants.stripePayoutsEnabled`, `tenants.platformMarginBps`; `stripe-events.ts` for webhook idempotency | `StripeConnectStatusDto` in `@towdispatch/shared` | **PARTIALLY BUILT** — see judgment call below | Stripe Connect onboarding for the tenant to **accept** payments is built end-to-end and lives at `/billing/payments-settings`. The platform-margin (basis points the platform keeps on each charge) is editable. There is no SaaS subscription billing — i.e., the tow company does not pay Tow Dispatch for the app — so there is nothing to wire for "subscription" today. |

## Routing / shell conventions observed

- The app uses **path segments**, not query strings, for sub-nav state:
  `/billing/invoices`, `/billing/payments`, `/accounting/settings`,
  `/accounting/mapping`. The `/settings` shell will follow the same
  pattern (e.g. `/settings/company`, `/settings/services`).
- Existing horizontal sub-nav layouts: `apps/web/src/app/(app)/billing/layout.tsx`,
  `apps/web/src/app/(app)/accounting/layout.tsx`. The spec for this work
  asks for a **left-side** sub-nav, which is intentionally different so
  the eight tabs read as a vertical settings index rather than a tab
  strip. Card / typography / spacing tokens stay shared with the rest
  of the app shell (`bg-bg-surface`, `border-divider`, `font-condensed`,
  `text-text-secondary-on-dark`, etc.).
- Existing placeholder pattern: `apps/web/src/app/(app)/ecosystem/ecosystem-placeholder.tsx`.
  The settings "Coming soon" card adopts the same visual idiom (rounded
  card on `bg-bg-surface`, pill chip, descriptive paragraph) so the
  shell feels native.
- Sidebar active state: the recently-merged Motor Clubs fix
  (`apps/web/src/components/app-shell/sidebar.tsx`) uses a per-item
  `match(pathname, searchParams)` predicate. Settings will adopt the
  same pattern with `p.startsWith('/settings')`.

## Backlog items surfaced during discovery (logged, not fixed here)

1. **`/billing/payments-settings` is mis-shelved.** It is conceptually a
   tenant setting (Stripe Connect + platform margin), not a billing
   workflow. Once `/settings/billing` exists, the `/billing` sub-nav can
   drop the "Payments settings" tab and the canonical home becomes
   `/settings/billing`. Out of scope for this PR.
2. **`accounts.defaultRateSheetId` is editable via API but invisible in
   the account form.** `apps/web/src/app/(app)/accounts/account-form.tsx`
   has no field for it, so dispatchers cannot set per-account pricing
   today without a direct API call.
3. **No `tenant_tax_settings` schema.** Tax is per-line on every invoice
   with a hard-coded `'0'` default. A tenant-wide tax configuration
   (jurisdiction, default rate, taxability rules per line type) is
   missing.
4. **No invite flow.** `POST /users` requires a password. Standard SaaS
   onboarding uses an invite email with a setup link; this is not
   modeled.
5. **No notification preferences schema or service.** Transactional
   emails are emitted ad-hoc; turning them off per-tenant or per-user
   is not possible.
6. **`Email Settings` sidebar item is hard-coded as disabled.** With
   `/settings/notifications` landing, that sidebar entry can be removed
   in a follow-up since Notifications subsumes it.
7. **`rates` module has no HTTP controller.** The engine is consumed
   internally by intake/billing only. CRUD endpoints will be needed
   before Services & Pricing or Account Rate Cards can ship a real UI.

## Judgment calls for the shell build

1. **Path segments over query strings.** The spec offered either; every
   existing sub-nav in the codebase uses path segments, so the settings
   shell does too. Tab slugs are kebab-case singular nouns:
   `company`, `services`, `account-rates`, `tax-fees`,
   `invoice-defaults`, `users`, `notifications`, `billing`.
2. **`/settings` root redirects to `/settings/company`.** Matches the
   "default tab: Company Profile" requirement without introducing two
   pages that render the same content.
3. **`/settings/billing` links out to `/billing/payments-settings`
   instead of embedding it or moving it.** The instructions said "wrap;
   do not extend" and "do not modify existing API endpoints" — the
   existing route already works and is the legitimate Stripe Connect
   home today. The settings tab presents it as a referenced card with a
   "Open Stripe Connect settings →" link, plus a "Coming soon" card for
   the (genuinely unbuilt) SaaS subscription side. The mis-shelf is
   logged in the backlog above.
4. **Left rail instead of horizontal tabs.** The spec asked for a
   left-side sub-nav with content on the right. Billing and Accounting
   use horizontal strips, but a vertical rail is appropriate here
   because there are eight tabs (a horizontal strip would wrap at most
   screen widths) and because these are settings, not workflows — a
   denser, list-style nav is more idiomatic.
