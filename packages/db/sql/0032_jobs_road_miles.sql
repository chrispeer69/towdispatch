-- Migration 0032 — Add road-mile tracking + dispatch yard reference to jobs
--
-- Adds three nullable columns to the jobs table:
--   enroute_miles      — road miles from the assigned dispatch yard to the
--                        pickup address (yard → pickup leg)
--   intow_miles        — road miles from the pickup to the dropoff (pickup
--                        → dropoff leg). Null for non-tow jobs (jump start,
--                        lockout, etc) where there is no dropoff.
--   dispatch_yard_id   — the yard the truck dispatched from. Used as the
--                        origin for enroute mile calculation. Nullable so
--                        existing rows don't break the migration.
--
-- These are computed at job-creation time using the Mapbox Directions API
-- (or Google Routes API when the tenant flag is set). The values are then
-- read by the rate engine to generate per-mile invoice line items.
--
-- Idempotent: every ALTER uses IF NOT EXISTS / IF EXISTS, the column adds
-- are non-destructive bigint metadata-only operations on Postgres.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS enroute_miles numeric(8,2),
  ADD COLUMN IF NOT EXISTS intow_miles numeric(8,2),
  ADD COLUMN IF NOT EXISTS dispatch_yard_id uuid;

-- Index dispatch_yard_id for the small set of "all jobs from this yard"
-- queries reports will run.
CREATE INDEX IF NOT EXISTS jobs_dispatch_yard_idx
  ON jobs (tenant_id, dispatch_yard_id)
  WHERE dispatch_yard_id IS NOT NULL;

-- jobs already has full audit triggers; column adds inherit the trigger.
