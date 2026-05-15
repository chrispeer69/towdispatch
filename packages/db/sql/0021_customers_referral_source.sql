-- =====================================================================
-- 0021_customers_referral_source.sql  (Session 9.5 — demo seed support)
--
-- Adds a nullable referral_source column to customers so the cash-customer
-- intake flow can record where a walk-in came from ("google_ad", "yelp",
-- "referral", "walk_in", ...). Free-text on the DB side; product layer is
-- free to constrain to a vocabulary later. No backfill — existing rows stay
-- NULL.
--
-- Companion Drizzle schema field: customers.referralSource (text, nullable).
-- Column-only addition, so no separate drizzle migration is generated; the
-- Drizzle TS schema is kept in sync at packages/db/src/schema/customers.ts.
-- See BUILD_DECISIONS.md (Session 9.5) for the rationale.
--
-- Down (rollback) — run by hand if the column needs to come out:
--   ALTER TABLE customers DROP COLUMN IF EXISTS referral_source;
-- =====================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referral_source text;
