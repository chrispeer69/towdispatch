# Session 47 — Canada Expansion · Decision Log

Branch: `feature/session-47-canada-expansion` · Migration: `0047`

Every non-obvious call made this session, with rationale. No questions were asked
of the operator (per CLAUDE.md Rule 1); ambiguities were resolved toward existing
patterns and the safer/more-reversible option.

---

## D1 — Worktree bootstrap
The launch named worktree `/tmp/claude-worktrees/canada-expansion` on branch
`feature/session-47-canada-expansion`, which did not exist. Created it off
`origin/master` (tip `0715834`, post-S36 merge) and pushed the feature ref —
same bootstrap pattern as prior sessions. Pre-flight grep confirmed no prior
Canada work on master.

## D2 — i18n framework: **next-intl** (not react-intl)
- App Router-native: first-class RSC support, `getTranslations`/`useTranslations`,
  a server `getRequestConfig` resolver. react-intl is client-centric and would
  fight RSC.
- Used **without i18n routing** (no `[locale]` URL segment). Locale is resolved
  per request from cookie → `Accept-Language` → `en-US`, and the tenant default
  is applied client-side from the session. This avoids restructuring all ~50
  routes under a `[locale]` segment — a large, risky change with no product
  benefit (the tenant, not the URL, owns the locale).

## D3 — Locale resolution priority
`resolveLocale()` order, highest first: **user preference → tenant default →
Accept-Language → en-US**. The launch wrote "tenant → user override → header →
fallback"; "override" means the user's explicit choice outranks the tenant
default. Since `tenant.default_locale` is NOT NULL (always present), checking it
before the user preference would make the override unreachable — so user wins.

## D4 — Tax rate precision: `rate_bps` is `numeric`, not integer
Quebec QST is 9.975% = **997.5** basis points, which is not an integer. Storing
`rate_bps` as `numeric(9,4)` keeps every rate exact (HST 13% = 1300, QST = 997.5)
while honoring the launch's `rate_bps` name. Drizzle surfaces numeric as a
string; the engine parses with `Number()`.

## D5 — Per-line CRA rounding
`computeTax` rounds each tax component to the cent independently against the same
base (GST and QST each rounded separately), per CRA practice. QC on $100: GST
$5.00 + QST round($9.975) = $9.98 → **$14.98**. The launch's "$14.975" is the
pre-rounding figure; real cents must round.

## D6 — `tax_rules` is GLOBAL reference (no RLS), with a reserved override column
Statutory rates are public and identical for every operator in a jurisdiction —
same convention as `lien_state_rules` (S23). A nullable `tenant_override_id` is
reserved for a future per-tenant custom rate; **v1 seeds only base rows
(`tenant_override_id IS NULL`)**. Because the table is non-RLS, any future
override insertion must be tenant-scoped in the app layer (noted in the SQL).

## D7 — Each jurisdiction fully enumerates its tax lines
No cross-row "federal GST applies everywhere" inference. HST provinces get one
HST row; GST+PST/QST provinces get a GST row plus a provincial row; AB and the
territories get GST only. `computeTax(country, region)` selects exactly the rows
for that region. Simpler, explicit, and order-controlled via `display_order`.

## D8 — Jurisdiction sourced from the invoice billing address
`recomputeTotals` reads the province from the snapshotted `billing_address.state`
— where sales/value tax legally sources from (same basis US sales tax uses).
Falls back to the existing US per-line model when country ≠ CA or no province is
present, so **US invoices are unchanged** (zero regression).

## D9 — Stored tax-line name is localized at compute time
`invoice_taxes.tax_name` is written as the tenant-locale name (HST for en, TVH
for fr) chosen from the rule's `name_en`/`name_fr` by `tenant.default_locale`.
Avoids a schema change to `invoice_taxes` and makes French invoices render
correctly from stored data.

## D10 — Canonical storage unchanged
Money stays integer **cents**; distance stays canonical **miles**; temperature
conversions treat **Celsius** as the metric-native base. Currency/unit/locale are
presentation only. Conversions + formatters are pure functions in
`@ustowdispatch/shared` (consumed by API and web); `apps/api/src/common/units`
and `.../common/address/postal.ts` re-export them at the spec-named paths.

## D11 — Shared pure logic, tests in API
`packages/shared` has no vitest runner (`"test": "echo …"`). Postal/tax/units/
locale logic lives in shared (single source of truth, imported by both apps); the
unit tests live under `apps/api/test` (which resolves `@ustowdispatch/shared` to
source) so they actually execute.

## D12 — New tenant-config fields are OPTIONAL on `AuthTenantDto`
Added `country/defaultLocale/defaultCurrency/defaultUnitSystem` as optional on the
wire. The canonical `toTenantDto` (used by `/auth/me`, login, signup, MFA) always
populates them from the tenant row; only the rare accept-invite token-issue path
omits them (it lacks the full row), and it is immediately followed by an
`/auth/me` call. Keeps the auth blast radius to a single function — CLAUDE.md says
not to modify the auth model beyond a user locale field. `users.locale_preference`
is the one permitted user-model addition (`AuthUserDto.localePreference`,
nullable).

## D13 — Phone format: no change
Both US and Canada use NANP (+1, `(XXX) XXX-XXXX`). The existing E.164
`phoneE164Schema` already covers both. Nothing to do.

## D14 — Tax 2026 rates: source + refresh
Source: CRA GST/HST table + provincial finance ministries (QST = Revenu Québec;
PST = BC/SK/MB). Nova Scotia HST is **14%** (reduced from 15% on 2025-04-01).
Refresh strategy: insert a superseding row with a new `effective_at` and stamp the
old row's `expires_at` — `selectApplicableRules(at)` then picks the right one.
Rates require finance review before production billing.

---

## Deferred (🟡) — out of scope this session

- **Strict postal/province enforcement at controller boundaries.** The validators
  + country-aware Zod factory ship and are tested, but retrofitting strict
  validation into existing customer/account/job-intake schemas risks rejecting
  existing US data and breaking current tests (country isn't always present at
  those boundaries). Wire `postalCodeSchema(country)` at onboarding/intake in a
  follow-up.
- **fr-CA operator-screen coverage.** v1 translates customer-facing + nav/common +
  invoice/portal keys. Deep operator screens (dispatch board, settings, reports)
  stay English by design; externalize them in a later mechanical pass.
- **Full string externalization.** Most existing hard-coded English strings remain
  inline. The next-intl provider + bundles are in place; pulling every string into
  `messages/*` is a large mechanical pass deferred to a dedicated session.
- **Locale switcher UI + tenant→cookie sync.** No UI to set `NEXT_LOCALE`; locale
  comes from Accept-Language for anonymous portal visitors and from the tenant
  default for authenticated users (via the formatters hook). A switcher that writes
  the cookie is a follow-up.
- **Bilingual PDF invoices, French driver-app UI, province-specific lien laws,
  GST/HST registration workflow** — each its own session.

## Not touched
- Auth/session model beyond `users.locale_preference` + tenant config DTO fields.
- S23 `lien_state_rules` (US states only).
- Canonical storage units (miles, cents).
- The US per-line sales-tax path in `recomputeTotals`.
