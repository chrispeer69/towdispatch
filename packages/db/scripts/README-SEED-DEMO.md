# `seed-demo` — Roadside demo tenant

`packages/db/scripts/seed-demo.ts` builds a single, curated tenant ("Roadside Towing and Recovery, Inc.", slug `roadside`) for the founder walkthrough. It is **not** a fixture for the test suite and it is **not** the same as `pnpm db:seed` (the dev fixture seed).

## Run it

```sh
# Local DB (default)
pnpm db:seed:demo

# Local DB, wipe the tenant first then re-seed cleanly
pnpm db:seed:demo --reset

# Staging
STAGING_DATABASE_ADMIN_URL=postgres://... pnpm db:seed:demo --target=staging --reset

# Production — refuses without the confirm env var
SEED_DEMO_CONFIRM=YES_I_AM_SURE \
  PRODUCTION_DATABASE_ADMIN_URL=postgres://... \
  pnpm db:seed:demo --target=production --reset
```

## Flags

| Flag                 | Default | Meaning                                                                     |
|----------------------|---------|-----------------------------------------------------------------------------|
| `--target=<env>`     | `local` | One of `local | staging | production`. Picks the connection URL.            |
| `--reset`            | off     | Delete the demo tenant (and everything below it) before seeding.            |
| `--help`             |         | Print usage.                                                                |

## Required environment

| Target       | Env var                             | Fallback                |
|--------------|-------------------------------------|-------------------------|
| `local`      | `DATABASE_ADMIN_URL`                | `DATABASE_URL`          |
| `staging`    | `STAGING_DATABASE_ADMIN_URL`        | `DATABASE_ADMIN_URL`    |
| `production` | `PRODUCTION_DATABASE_ADMIN_URL`     | `DATABASE_ADMIN_URL`    |
| `production` | `SEED_DEMO_CONFIRM=YES_I_AM_SURE`   | — required; no fallback |

The script connects with the **admin** URL because seeding `tenants`, `audit_log`, and a few RLS-protected paths needs the bypass role.

## Idempotency

Every row inserted by this script has a deterministic UUID derived from `sha1("roadside:<scope>:<key>")`. Re-running without `--reset` therefore:

- Inserts each row exactly once.
- Refreshes `tenants.settings`, the default-rate-sheet pointer, and the account → rate sheet linkage. Edits to those payloads ship on the next run.
- Leaves jobs / invoices / payments untouched once they exist (they're driven by the same deterministic IDs but their numeric state is frozen at first insert).

`--reset` deletes every row owned by the tenant in FK-safe order before any inserts. The tenant row is deleted last; the next pass re-creates it.

## Production checklist

1. `pnpm --filter @towdispatch/db build` (TS → JS for migrations).
2. (one-time) `pnpm db:migrate` — applies `sql/0021_customers_referral_source.sql`.
3. `SEED_DEMO_CONFIRM=YES_I_AM_SURE pnpm db:seed:demo --target=production --reset`.
4. Verify counts in `POST_SEED_REPORT.md` (written at repo root on every successful run).
5. Open the walkthrough URLs from the report.

## What you get

- **1 tenant** — `roadside`, Columbus OH metadata, accounting integration `disconnected`, two yards in `tenants.settings.yards`, OH + Franklin County tax rates and taxability config in `tenants.settings.taxRates` / `taxability`.
- **13 users** — owner (`chris@roadside.demo`) + admin, accounting, auditor, manager, two dispatchers, six drivers. Password `TempPass#001` on every account. `lastLoginAt` is left `NULL` on every user — the app uses that as the "force password rotation on first login" signal.
- **6 drivers** — five at Main Yard, one at Lewis Center. CDL class B / A mix, OH licenses.
- **16 trucks** — units 101–116 across the two yards (10 light-duty, 4 medium-duty, 2 heavy-duty including a Peterbilt 567 rotator and a Kenworth T880). Primary driver assignments for the six drivers.
- **2 commercial accounts** — `AAAX Motor Club` (Net 45, `isMotorClub=true`) and `SheetzX, Inc.` (Net 30).
- **7 customers** — AAAX dispatch contact, SheetzX fleet contact, Marcus Johnson (cash + `referral_source=google_ad`), three more cash customers, and one write-off cash customer.
- **12 vehicles** — distributed across the customers, OH plates (one PA SheetzX van), valid 17-char VINs.
- **3 rate sheets** — Default Retail (tenant default), AAAX Motor Club (account override), SheetzX Commercial (account override, 15% off retail).
- **8 jobs** — exactly the matrix the founder walkthrough scripts call for:
  - 1 paid AAAX (25d ago)
  - 1 aged-sent AAAX (47d ago, past Net 45 by 2d)
  - 1 paid SheetzX (17d ago)
  - 1 partially paid SheetzX (50% paid)
  - 1 cash-receipt paid at scene (Marcus Johnson)
  - 1 open `on_scene` AAAX (35m ago)
  - 1 open `enroute` SheetzX (8m ago)
  - 1 completed-yesterday cash with a DRAFT invoice
- **1 historical write-off** — 90-day-old cash invoice for $217.00 paid via `payment_method=write_off`, demonstrating `/billing/adjustments?kind=write_off`.

## Limits

- The web app has no `yards` table yet. Yards are stored in `tenants.settings.yards`; drivers carry `assignedYardId` against those UUIDs (forward-stub FK per the existing schema comment). Trucks reference their yard in `trucks.notes` and the `tenants.settings.truckYardAssignments` map.
- The `rateSheets.definition` schema cannot represent percentage surcharges. The "25% after-hours" rule lives in `tenants.settings.billingPolicies.afterHoursSurchargePct`; rate sheets carry a placeholder window with `amountCents=0` and a label calling out the rule.
- `users.must_change_password` does not exist in the schema. The seed leans on the existing `lastLoginAt IS NULL` convention.
- No real PDFs are generated. Invoices have a placeholder `notes` line; `pdf_s3_key` is not a column on `invoices` today (the planned PDF column is not yet shipped).
- No QBO connection, Stripe customer object, payment intent, or webhook event is created.

See `BUILD_DECISIONS.md` for the rationale behind each of the above.
