# Session 47 — Canada Expansion

**TL;DR.** TowCommand can now serve Canadian operators. Tenants carry a country,
locale, currency, and unit system; a new global `tax_rules` reference computes
GST/HST/PST/QST (multi-line, CRA-rounded) wired into invoice totals; a shared
i18n layer adds postal validation, locale resolution, and presentation
formatting; the web app gains a next-intl provider (en-US / en-CA / fr-CA) with
customer-facing French and a tenant-aware money/distance/date formatter hook.
US behavior is unchanged. Migration `0047`. Decision log: `SESSION_47_DECISIONS.md`.

---

## What shipped ✅

**DB — `packages/db/sql/0047_canada_expansion.sql` + Drizzle schema**
- `tenants` += `country` (US) · `default_locale` (en-US) · `default_currency`
  (USD) · `default_unit_system` (imperial), with format CHECKs. Audit-safe
  (to_jsonb trigger is column-agnostic). Idempotent DO-block ADD COLUMN.
- `users` += `locale_preference` (nullable BCP-47) — the only user-model change.
- `jurisdictions` (global ref): country + province/territory lookup, seeded with
  Canada's 13 jurisdictions incl. French names.
- `tax_rules` (global ref, no RLS): `rate_bps numeric` (exact for QST 9.975%),
  `tenant_override_id` reserved, 2026 GST/HST/PST/QST seeded for all 13.
- Drizzle: `jurisdictions.ts`, `tax-rules.ts`, tenants/users updates, barrel.

**Shared — `packages/shared/src/i18n/`** (pure, consumed by API + web)
- `locales.ts`: supported locale/currency/unit/country vocab + Zod + CA province
  codes + country defaults.
- `resolve.ts`: `resolveLocale` (user → tenant → Accept-Language → en-US),
  q-weighted Accept-Language parsing, BCP-47 coercion.
- `format.ts`: miles↔km, °C↔°F, `formatMoney`, `formatDistance`,
  `formatTemperature`, `formatDate`/`formatDateTime` (exact per-locale patterns,
  ICU-independent).
- `postal.ts`: US ZIP + Canadian postal regex/validators, country-aware Zod.

**API**
- `modules/billing/tax.ts`: pure `computeTax(taxableCents, rules, locale)` →
  `{ lines, totalTaxCents }` + `selectApplicableRules(at)`.
- `recomputeTotals`: CA branch sources rates from `tax_rules` by billing-address
  province and emits localized multi-line tax; US per-line path untouched.
- `common/units/`, `common/address/postal.ts`: spec-path re-exports of shared.
- `AuthTenantDto` += tenant config (optional); `AuthUserDto` += `localePreference`;
  populated in `toTenantDto`/`toUserDto`.

**Web (`apps/web`)**
- next-intl **without routing**: `src/i18n/request.ts` resolver,
  `createNextIntlPlugin` in `next.config.mjs`, `NextIntlClientProvider` in the
  root layout, `<html lang>` from the resolved locale.
- `messages/{en-US,en-CA,fr-CA}.json`: common, nav, job statuses, invoice, portal.
- `lib/i18n/formatters.ts`: `useTenantFormatters()` — money/distance/date bound to
  tenant currency/unit + resolved locale. Applied on the impound list.

## Tests

| Suite | Result |
|---|---|
| `pnpm typecheck` (6 pkgs) | ✅ clean |
| `pnpm biome check` (changed files) | ✅ clean |
| API `pnpm test` | ✅ **530 passed, 470 skipped** (DB specs self-skip w/o `.env`), 0 failed |
| Web `pnpm test` | 59 passed; new `messages.spec` ✅. 2 pre-existing failures (see below) |
| `next build` | ✅ Compiled successfully |

New specs (38): `canada-postal` (9), `canada-tax` (8), `canada-format-units`
(10), `canada-locale-resolution` (7), web `messages` (3) + 1 fixed assertion.
Tax assertions: ON HST 13% → $13.00; QC GST $5.00 + QST $9.98 → $14.98 (GST line
first); fr-CA names TVH/TPS/TVQ.

## Deferred 🟡
Strict postal/province enforcement at controller boundaries (validators shipped
+ tested; wiring deferred to avoid US-data regressions); fr-CA operator-screen
coverage; full string externalization; locale-switcher UI + cookie sync;
bilingual PDF invoices; French driver-app; province-specific lien laws; GST/HST
registration. See `SESSION_47_DECISIONS.md`.

## Not touched
Auth/session model (beyond the locale fields); S23 `lien_state_rules`; canonical
storage units; the US per-line sales-tax path.

## Known issues (pre-existing, not regressions)
- Web `offline-queue.spec` fails locally on a `window.location`/env gap
  (documented; web unit tests aren't in CI — only `e2e.yml` gates PRs).
- Web `reporting.spec` fails at collection on `auth/cookies.ts` → `next/headers`
  outside a request scope (node vitest env). Neither file was touched here.

## Commands
```
pnpm typecheck
pnpm biome check .
pnpm --filter @ustowdispatch/api test
pnpm --filter @ustowdispatch/web test
pnpm --filter @ustowdispatch/web build
```

## Migration note
Kept the launch-assigned `0047` (master tops out at `0042`; `0043–0046` unused).
Gaps are harmless — `migrate.ts` re-applies every idempotent `sql/*.sql` each run.
