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
