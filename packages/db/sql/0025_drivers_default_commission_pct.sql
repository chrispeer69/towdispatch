-- =====================================================================
-- 0025_drivers_default_commission_pct.sql  (Admin Settings — build 3 of 6)
--
-- Adds the Default Commission % field to drivers. This is the single
-- source of truth for what percentage of an invoice line a driver
-- earns as commission by default. Per-line overrides happen at invoice
-- time (build 4) and read this column as their default.
--
-- Design notes:
--   * numeric(5,2) — supports 0.00 through 100.00 with two decimals.
--   * NULL is meaningful: "no default set"; the dispatcher must enter
--     a value manually during invoice review when this is null.
--   * CHECK 0..100 enforced at the DB so an out-of-band write (import,
--     manual SQL) cannot leave the field in a state the rate math
--     would mishandle.
--   * No data backfill — existing rows get NULL.
--   * Audit trigger trg_audit_drivers (0010_drivers_trucks_shifts.sql)
--     already captures UPDATE/INSERT/DELETE on the drivers table, so
--     changes to this column are audited automatically without an
--     additional trigger.
--
-- Idempotent: column add uses IF NOT EXISTS; constraint uses
-- DROP CONSTRAINT IF EXISTS + ADD pattern to match the file's siblings.
--
-- Down (rollback):
--   ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_default_commission_pct_range;
--   ALTER TABLE drivers DROP COLUMN IF EXISTS default_commission_pct;
-- =====================================================================

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS default_commission_pct numeric(5,2);

ALTER TABLE drivers
  DROP CONSTRAINT IF EXISTS drivers_default_commission_pct_range;
ALTER TABLE drivers
  ADD CONSTRAINT drivers_default_commission_pct_range
  CHECK (default_commission_pct IS NULL
         OR (default_commission_pct >= 0 AND default_commission_pct <= 100));
