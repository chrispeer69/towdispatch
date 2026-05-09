-- =====================================================================
-- 0007_customer_type_simplification.sql
--
-- Reclassify any existing customers.type='motor_club_member' rows to 'cash'
-- and add a CHECK constraint so only the new ('cash','account') values are
-- accepted going forward. Motor clubs are accounts, not customers — the
-- actual customer is the person whose vehicle is being towed.
--
-- The reclassification appends a structured note so nobody loses track of
-- which rows used to be motor_club_member. Use a CASE-aware UPDATE so the
-- note is appended (not overwritten) when notes are already present.
-- =====================================================================

UPDATE customers
SET
  type = 'cash',
  notes = CASE
    WHEN notes IS NULL OR notes = '' THEN 'Reclassified from motor_club_member type during cleanup'
    ELSE notes || E'\nReclassified from motor_club_member type during cleanup'
  END,
  updated_at = now()
WHERE type = 'motor_club_member';

-- Drop any prior version of the constraint (idempotent re-runs).
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_type_valid;
ALTER TABLE customers
  ADD CONSTRAINT customers_type_valid
  CHECK (type IN ('cash', 'account'));

-- created_via was added by the Drizzle migration immediately before this
-- one. Add a CHECK so the only legal entry points are surfaced explicitly.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_created_via_valid;
ALTER TABLE customers
  ADD CONSTRAINT customers_created_via_valid
  CHECK (created_via IN ('manual', 'auto_intake'));
