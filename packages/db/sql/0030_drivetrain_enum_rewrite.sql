-- =====================================================================
-- 0030_drivetrain_enum_rewrite.sql
--
-- Replace the legacy drivetrain enum (FWD/RWD/AWD/4WD/unknown) with the
-- operator-facing set the intake form actually exposes: 2WD, 4WD, RWD,
-- AWD, EV, Hybrid. The column also becomes nullable + default-less so a
-- dispatcher can leave it blank on a call where the powertrain isn't
-- known yet.
--
-- Data remap:
--   FWD     → 2WD  (front-wheel-drive is the most common "2WD" car)
--   RWD     → RWD  (no change)
--   AWD     → AWD  (no change)
--   4WD     → 4WD  (no change)
--   unknown → NULL (the field is now optional)
--
-- Idempotent: the migration runner re-applies all .sql files on every
-- deploy. DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT (the only piece
-- that's not natively idempotent in Postgres) is sequenced inside the
-- same transaction, so re-runs are safe — the constraint is dropped
-- before being re-added.
--
-- Down (rollback):
--   ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_drivetrain_check;
--   UPDATE vehicles SET drivetrain = 'FWD'     WHERE drivetrain = '2WD';
--   UPDATE vehicles SET drivetrain = 'unknown' WHERE drivetrain IS NULL;
--   ALTER TABLE vehicles ALTER COLUMN drivetrain SET NOT NULL;
--   ALTER TABLE vehicles ALTER COLUMN drivetrain SET DEFAULT 'unknown';
--   ALTER TABLE vehicles ADD  CONSTRAINT vehicles_drivetrain_check
--     CHECK (drivetrain IN ('FWD','RWD','AWD','4WD','unknown'));
-- =====================================================================

BEGIN;

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_drivetrain_check;

UPDATE vehicles SET drivetrain = '2WD'  WHERE drivetrain = 'FWD';
UPDATE vehicles SET drivetrain = NULL   WHERE drivetrain = 'unknown';

ALTER TABLE vehicles ALTER COLUMN drivetrain DROP DEFAULT;
ALTER TABLE vehicles ALTER COLUMN drivetrain DROP NOT NULL;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_drivetrain_check
  CHECK (drivetrain IS NULL OR drivetrain IN ('2WD', '4WD', 'RWD', 'AWD', 'EV', 'Hybrid'));

COMMIT;
