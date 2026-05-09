-- =====================================================================
-- 0009_customers_extended_contact.sql  (Session 4 cleanup)
--
-- Adds home address (split into discrete columns), secondary contact, and
-- Convini app installation flag to the customers table. Email is left
-- nullable here — the column-level NOT NULL would force a backfill of every
-- pre-existing customer, which could mask the audit trail. The intake API
-- (createJobIntakeSchema) enforces email at the Zod layer instead, so new
-- intakes cannot create email-less customers while existing rows keep their
-- shape until they're touched again.
--
-- Down (rollback) — run by hand if the columns need to come out:
--   ALTER TABLE customers
--     DROP COLUMN IF EXISTS home_address_street,
--     DROP COLUMN IF EXISTS home_address_city,
--     DROP COLUMN IF EXISTS home_address_state,
--     DROP COLUMN IF EXISTS home_address_zip,
--     DROP COLUMN IF EXISTS secondary_contact_name,
--     DROP COLUMN IF EXISTS secondary_contact_phone,
--     DROP COLUMN IF EXISTS convini_app_downloaded;
--   DROP INDEX IF EXISTS customers_tenant_zip_idx;
-- =====================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS home_address_street text,
  ADD COLUMN IF NOT EXISTS home_address_city   text,
  ADD COLUMN IF NOT EXISTS home_address_state  text,
  ADD COLUMN IF NOT EXISTS home_address_zip    text,
  ADD COLUMN IF NOT EXISTS secondary_contact_name  text,
  ADD COLUMN IF NOT EXISTS secondary_contact_phone text,
  ADD COLUMN IF NOT EXISTS convini_app_downloaded boolean NOT NULL DEFAULT false;

-- Two-letter US state code, when supplied, must be uppercase A-Z.
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_home_address_state_format;
ALTER TABLE customers
  ADD CONSTRAINT customers_home_address_state_format
  CHECK (home_address_state IS NULL OR home_address_state ~ '^[A-Z]{2}$');

-- Index supports zip-based filters (service area, mailings, route grouping).
DROP INDEX IF EXISTS customers_tenant_zip_idx;
CREATE INDEX customers_tenant_zip_idx
  ON customers (tenant_id, home_address_zip)
  WHERE home_address_zip IS NOT NULL AND deleted_at IS NULL;
