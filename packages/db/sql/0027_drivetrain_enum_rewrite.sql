-- =====================================================================
-- 0027_drivetrain_enum_rewrite.sql
--
-- Replace the legacy drivetrain enum (FWD/RWD/AWD/4WD/unknown) with the
-- operator-facing set the intake form actually exposes: 2WD, 4WD, RWD,
-- AWD, EV, Hybrid. The column also becomes nullable + default-less so a
-- dispatcher can leave it blank on a call where the powertrain isn't
-- known yet.
--
-- Data remap:
--   FWD     → 2WD  (front-wheel-drive is the most common "2WD" car)
--   RWD     → RWD
--   AWD     → AWD
--   4WD     → 4WD
--   unknown → NULL  (the field is now optional)
--
-- The legacy enum's check constraint is named vehicles_drivetrain_check
-- by Postgres convention (table_column_check). If your earlier migration
-- gave it a different name, swap it in below.
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
