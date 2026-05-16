-- =====================================================================
-- 0022_service_catalog.sql  (Admin Settings — build 1 of 6)
--
-- Adds the tenant-level Service Catalog: the structural list of services a
-- tow operator bills for (Tow, Mileage, Admin Fee, Storage, etc.). Prices
-- are out of scope here — they live in rate_sheets (build 2). This file
-- creates the table, wires RLS + the audit trigger, and ships a SECURITY
-- DEFINER helper fn_seed_default_service_catalog(tenant_id) that seeds the
-- 45-row default catalog for any tenant that has zero service rows. The
-- helper is then invoked for every existing tenant at the end of the file
-- so production tenants get the catalog the moment this migration applies.
--
-- Down (rollback) — run by hand if the table needs to come out:
--   DROP TRIGGER  IF EXISTS trg_audit_service_catalog ON service_catalog;
--   DROP FUNCTION IF EXISTS fn_seed_default_service_catalog(uuid);
--   DROP TABLE    IF EXISTS service_catalog;
--
-- Invariants:
--   * Every tenant-scoped table is FORCE RLS — no exceptions.
--   * Soft-deleted services do not collide on (tenant, code) — partial
--     unique index excludes tombstones, so a code can be re-used after a
--     legitimate delete.
--   * calculation_unit = 'quoted'  <=>  is_quoted = true. CHECK constraint
--     makes contradictory state unrepresentable; either field can drive
--     the UI on save and the other is derived.
--   * default_commission_pct_override is 0..100 inclusive (or NULL =
--     "use the driver's default commission").
--   * applicable_vehicle_classes is validated application-side against
--     the VehicleClass enum in @ustowdispatch/shared. The DB column is
--     plain text[] because postgres can't reference a TS enum.
-- =====================================================================

CREATE TABLE IF NOT EXISTS service_catalog (
  id                                uuid PRIMARY KEY,
  tenant_id                         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code                              text NOT NULL,
  name                              text NOT NULL,
  description                       text,
  category                          text NOT NULL,
  calculation_unit                  text NOT NULL,
  applicable_vehicle_classes        text[] NOT NULL DEFAULT '{}',
  is_quoted                         boolean NOT NULL DEFAULT false,
  default_commission_pct_override   numeric(5,2),
  supports_per_resource_multiplier  boolean NOT NULL DEFAULT false,
  is_active                         boolean NOT NULL DEFAULT true,
  sort_order                        integer NOT NULL DEFAULT 0,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  deleted_at                        timestamptz,
  created_by                        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by                        uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE service_catalog
  DROP CONSTRAINT IF EXISTS service_catalog_category_chk;
ALTER TABLE service_catalog
  ADD CONSTRAINT service_catalog_category_chk
  CHECK (category IN (
    'towing', 'mileage', 'roadside_service', 'recovery',
    'storage_impound', 'fees_surcharges', 'adjustments',
    'equipment', 'overages'
  ));

ALTER TABLE service_catalog
  DROP CONSTRAINT IF EXISTS service_catalog_calculation_unit_chk;
ALTER TABLE service_catalog
  ADD CONSTRAINT service_catalog_calculation_unit_chk
  CHECK (calculation_unit IN (
    'per_call', 'per_mile', 'per_hour', 'per_quarter_hour', 'per_day', 'quoted'
  ));

ALTER TABLE service_catalog
  DROP CONSTRAINT IF EXISTS service_catalog_is_quoted_consistency_chk;
ALTER TABLE service_catalog
  ADD CONSTRAINT service_catalog_is_quoted_consistency_chk
  CHECK ((calculation_unit = 'quoted') = is_quoted);

ALTER TABLE service_catalog
  DROP CONSTRAINT IF EXISTS service_catalog_commission_range_chk;
ALTER TABLE service_catalog
  ADD CONSTRAINT service_catalog_commission_range_chk
  CHECK (
    default_commission_pct_override IS NULL
    OR (default_commission_pct_override >= 0 AND default_commission_pct_override <= 100)
  );

ALTER TABLE service_catalog
  DROP CONSTRAINT IF EXISTS service_catalog_code_format_chk;
ALTER TABLE service_catalog
  ADD CONSTRAINT service_catalog_code_format_chk
  CHECK (code ~ '^[A-Z][A-Z0-9_]*$');

-- ---------- indexes ----------
DROP INDEX IF EXISTS service_catalog_tenant_code_unique;
CREATE UNIQUE INDEX service_catalog_tenant_code_unique
  ON service_catalog (tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS service_catalog_tenant_category_idx
  ON service_catalog (tenant_id, category);

CREATE INDEX IF NOT EXISTS service_catalog_tenant_active_idx
  ON service_catalog (tenant_id, is_active);

-- ---------- RLS ----------
ALTER TABLE service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_catalog FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_catalog_tenant_isolation ON service_catalog;
CREATE POLICY service_catalog_tenant_isolation ON service_catalog
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------- audit ----------
DROP TRIGGER IF EXISTS trg_audit_service_catalog ON service_catalog;
CREATE TRIGGER trg_audit_service_catalog
  AFTER INSERT OR UPDATE OR DELETE ON service_catalog
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- seed function ----------
-- SECURITY DEFINER so it can INSERT into service_catalog regardless of the
-- caller's RLS context. The function refuses to seed if the tenant already
-- has any rows (deleted or not) — we never overwrite a configured catalog.
-- Returns the number of rows inserted so callers can report the result.
--
-- The 45-row default catalog covers: the Towbook-style baseline the founder
-- runs today (33 services + the 'Adjustment to reflect payment difference'
-- line item), 7 founder-added services (Wait Time, Cleanup, Notification
-- Fee, Lien Processing, Sales Advertising, Title Transfer, Tarping), and
-- the 4 Overage rows (Tow / Tow Hook / Mileage / Winch Overage — the
-- attachment-to-parent model is a TODO for build 4).
CREATE OR REPLACE FUNCTION fn_seed_default_service_catalog(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'fn_seed_default_service_catalog: tenant_id is required';
  END IF;

  SELECT count(*) INTO v_count FROM service_catalog WHERE tenant_id = p_tenant_id;
  IF v_count > 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO service_catalog (
    id, tenant_id, code, name, description, category, calculation_unit,
    applicable_vehicle_classes, is_quoted, supports_per_resource_multiplier,
    sort_order
  )
  VALUES
    -- ---------- towing ----------
    (gen_random_uuid(), p_tenant_id, 'TOW',                       'Tow',                       'Standard light-duty tow',                                 'towing',           'per_call',  ARRAY['light_duty'],                                                     false, false, 10),
    (gen_random_uuid(), p_tenant_id, 'TOW_W_DOLLIES',             'Tow w/Dollies',             'Tow performed with dollies',                              'towing',           'per_call',  ARRAY['light_duty','medium_duty'],                                       false, false, 20),
    (gen_random_uuid(), p_tenant_id, 'TWO_WAY_TOW',               '2-way Tow',                 'Round-trip tow; price entered at quote time',             'towing',           'quoted',    ARRAY['light_duty','medium_duty','heavy_duty'],                          true,  false, 30),
    (gen_random_uuid(), p_tenant_id, 'ACCIDENT_TOW',              'Accident Tow',              'Tow from accident scene',                                 'towing',           'per_call',  ARRAY['light_duty','medium_duty','heavy_duty'],                          false, false, 40),
    (gen_random_uuid(), p_tenant_id, 'MEDIUM_DUTY_TOW',           'Medium Duty Tow',           'Medium-duty class tow',                                   'towing',           'per_call',  ARRAY['medium_duty'],                                                    false, false, 50),
    (gen_random_uuid(), p_tenant_id, 'HEAVY_DUTY_TOW',            'Heavy Duty Tow',            'Heavy-duty class tow',                                    'towing',           'per_call',  ARRAY['heavy_duty'],                                                     false, false, 60),
    (gen_random_uuid(), p_tenant_id, 'SECONDARY_TOW',             'Secondary Tow',             'Tow performed as the second leg of a relay',              'towing',           'per_call',  ARRAY['light_duty','medium_duty','heavy_duty'],                          false, false, 70),
    (gen_random_uuid(), p_tenant_id, 'HOOK_FEE',                  'Hook Fee',                  'Flat fee for connecting the vehicle to the truck',        'towing',           'per_call',  ARRAY['light_duty','medium_duty','heavy_duty'],                          false, false, 80),
    (gen_random_uuid(), p_tenant_id, 'GOA_LIGHT_DUTY_TOW',        'GOA Light Duty Tow',        'Gone-on-arrival fee for a light-duty tow',                'towing',           'per_call',  ARRAY['light_duty'],                                                     false, false, 90),

    -- ---------- mileage ----------
    (gen_random_uuid(), p_tenant_id, 'DEADHEAD_MILEAGE',          'Deadhead Mileage',          'Empty miles back to base after a job',                    'mileage',          'per_mile',  ARRAY[]::text[],                                                         false, false, 100),
    (gen_random_uuid(), p_tenant_id, 'LOADED_HOOKED_MILEAGE',     'Loaded/Hooked Mileage',     'Per-mile rate while a vehicle is on the truck',           'mileage',          'per_mile',  ARRAY['light_duty','medium_duty','heavy_duty'],                          false, false, 110),
    (gen_random_uuid(), p_tenant_id, 'UNLOADED_ENROUTE_MILEAGE',  'Unloaded/Enroute Mileage',  'Per-mile rate while enroute to the pickup',               'mileage',          'per_mile',  ARRAY[]::text[],                                                         false, false, 120),
    (gen_random_uuid(), p_tenant_id, 'SECONDARY_TOW_ENROUTE_MILES','Secondary Tow En-route Miles','Enroute miles for a secondary tow',                     'mileage',          'per_mile',  ARRAY['light_duty','medium_duty','heavy_duty'],                          false, false, 130),
    (gen_random_uuid(), p_tenant_id, 'SECONDARY_TOW_LOADED_MILES','Secondary Tow Loaded Miles','Loaded miles for a secondary tow',                        'mileage',          'per_mile',  ARRAY['light_duty','medium_duty','heavy_duty'],                          false, false, 140),

    -- ---------- roadside_service ----------
    (gen_random_uuid(), p_tenant_id, 'JUMP_START_SERVICE',        'Jump Start Service',        'On-scene jump start',                                     'roadside_service', 'per_call',  ARRAY['light_duty'],                                                     false, false, 200),
    (gen_random_uuid(), p_tenant_id, 'BOOST',                     'Boost',                     'Battery boost (light duty)',                              'roadside_service', 'per_call',  ARRAY['light_duty'],                                                     false, false, 210),
    (gen_random_uuid(), p_tenant_id, 'LOCKOUT_SERVICE',           'Lockout Service',           'Unlock vehicle on scene',                                 'roadside_service', 'per_call',  ARRAY['light_duty'],                                                     false, false, 220),
    (gen_random_uuid(), p_tenant_id, 'TIRE_SERVICE',              'Tire Service',              'Tire change / inflation on scene',                        'roadside_service', 'per_call',  ARRAY['light_duty'],                                                     false, false, 230),
    (gen_random_uuid(), p_tenant_id, 'FUEL_DELIVERY_SERVICE',     'Fuel Delivery Service',     'Service charge for fuel delivery',                        'roadside_service', 'per_call',  ARRAY['light_duty'],                                                     false, false, 240),
    (gen_random_uuid(), p_tenant_id, 'FUEL_COST_OF_FUEL',         'Fuel (cost of fuel)',       'Pass-through cost of fuel delivered',                     'roadside_service', 'per_call',  ARRAY[]::text[],                                                         false, false, 250),
    (gen_random_uuid(), p_tenant_id, 'GOA_NON_TOW',               'GOA Non-Tow',               'Gone-on-arrival fee for a non-tow service call',          'roadside_service', 'per_call',  ARRAY[]::text[],                                                         false, false, 260),

    -- ---------- recovery ----------
    (gen_random_uuid(), p_tenant_id, 'WINCHING',                  'Winching',                  'Winch / extraction',                                      'recovery',         'per_call',  ARRAY['light_duty','medium_duty','heavy_duty'],                          false, false, 300),
    (gen_random_uuid(), p_tenant_id, 'LABOR',                     'Labor',                     'Recovery labor billed hourly',                            'recovery',         'per_hour',  ARRAY[]::text[],                                                         false, false, 310),
    (gen_random_uuid(), p_tenant_id, 'WAIT_TIME',                 'Wait Time',                 'On-scene wait time, billed in 15-minute increments',      'recovery',         'per_quarter_hour', ARRAY[]::text[],                                                  false, false, 320),
    (gen_random_uuid(), p_tenant_id, 'CLEANUP',                   'Cleanup',                   'Scene cleanup, billed per hour per resource (man)',       'recovery',         'per_hour',  ARRAY[]::text[],                                                         false, true,  330),
    (gen_random_uuid(), p_tenant_id, 'TARPING',                   'Tarping',                   'Tarp load to contain debris',                             'recovery',         'per_call',  ARRAY[]::text[],                                                         false, false, 340),

    -- ---------- storage_impound ----------
    (gen_random_uuid(), p_tenant_id, 'STORAGE',                   'Storage',                   'Vehicle storage, billed per day',                         'storage_impound',  'per_day',   ARRAY[]::text[],                                                         false, false, 400),
    (gen_random_uuid(), p_tenant_id, 'DAILY_IMPOUND_RATE',        'Daily Impound Rate',        'Daily impound storage fee',                               'storage_impound',  'per_day',   ARRAY[]::text[],                                                         false, false, 410),

    -- ---------- fees_surcharges ----------
    (gen_random_uuid(), p_tenant_id, 'ADMIN_FEE',                 'Admin Fee',                 'Per-call administrative fee',                             'fees_surcharges',  'per_call',  ARRAY[]::text[],                                                         false, false, 500),
    (gen_random_uuid(), p_tenant_id, 'AFTER_HOUR_RELEASE_FEE',    'After Hour Release Fee',    'Fee to release a stored vehicle after business hours',    'fees_surcharges',  'per_call',  ARRAY[]::text[],                                                         false, false, 510),
    (gen_random_uuid(), p_tenant_id, 'CONVENIENCE_FEE',           'Convenience Fee',           'Quoted convenience fee (amount entered at quote time)',   'fees_surcharges',  'quoted',    ARRAY[]::text[],                                                         true,  false, 520),
    (gen_random_uuid(), p_tenant_id, 'FUEL_SURCHARGE',            'Fuel Surcharge',            'Per-call fuel surcharge',                                 'fees_surcharges',  'per_call',  ARRAY[]::text[],                                                         false, false, 530),
    (gen_random_uuid(), p_tenant_id, 'PRIVATE_PROPERTY_TOW_FEE',  'Private Property Tow Fee',  'PPI surcharge added to tows from private property',       'fees_surcharges',  'per_call',  ARRAY[]::text[],                                                         false, false, 540),
    (gen_random_uuid(), p_tenant_id, 'NOTIFICATION_FEE',          'Notification Fee',          'Per-call notification (lien letters, certified mail)',    'fees_surcharges',  'per_call',  ARRAY[]::text[],                                                         false, false, 550),
    (gen_random_uuid(), p_tenant_id, 'LIEN_PROCESSING',           'Lien Processing',           'Lien processing administrative fee',                      'fees_surcharges',  'per_call',  ARRAY[]::text[],                                                         false, false, 560),
    (gen_random_uuid(), p_tenant_id, 'SALES_ADVERTISING',         'Sales Advertising',         'Sale advertising fee (for auctioned vehicles)',           'fees_surcharges',  'per_call',  ARRAY[]::text[],                                                         false, false, 570),
    (gen_random_uuid(), p_tenant_id, 'TITLE_TRANSFER',            'Title Transfer',            'Title transfer fee',                                      'fees_surcharges',  'per_call',  ARRAY[]::text[],                                                         false, false, 580),

    -- ---------- adjustments ----------
    (gen_random_uuid(), p_tenant_id, 'PAY_OUT',                   'Pay Out',                   'Cash pay-out adjustment',                                 'adjustments',      'per_call',  ARRAY[]::text[],                                                         false, false, 600),
    (gen_random_uuid(), p_tenant_id, 'REASSIGNED_CANCEL',         'Reassigned/Cancel',         'Reassignment / cancellation adjustment',                  'adjustments',      'per_call',  ARRAY[]::text[],                                                         false, false, 610),
    (gen_random_uuid(), p_tenant_id, 'ADJUSTMENT_PAYMENT_DIFF',   'Adjustment to reflect payment difference', 'Quoted adjustment line that reconciles payment differences', 'adjustments', 'quoted', ARRAY[]::text[],                                              true,  false, 620),

    -- ---------- equipment ----------
    (gen_random_uuid(), p_tenant_id, 'DOLLIES',                   'Dollies',                   'Dollies (per call)',                                      'equipment',        'per_call',  ARRAY['light_duty','medium_duty'],                                       false, false, 700),
    (gen_random_uuid(), p_tenant_id, 'TWO_WAY_DOLLIES',           '2-way Dollies',             'Round-trip dollies; price entered at quote time',         'equipment',        'quoted',    ARRAY['light_duty','medium_duty'],                                       true,  false, 710),

    -- ---------- overages ----------
    -- The "attached to a parent service" relationship is intentionally NOT
    -- modeled in this build — overage attachment UI ships with the Master
    -- Rate Sheet (build 2). Until then these read as standalone per-call
    -- line items the dispatcher can add manually.
    (gen_random_uuid(), p_tenant_id, 'TOW_OVERAGE',               'Tow Overage',               'Overage on the parent tow service',                       'overages',         'per_call',  ARRAY[]::text[],                                                         false, false, 800),
    (gen_random_uuid(), p_tenant_id, 'TOW_HOOK_OVERAGE',          'Tow Hook Overage',          'Overage on the parent hook fee',                          'overages',         'per_call',  ARRAY[]::text[],                                                         false, false, 810),
    (gen_random_uuid(), p_tenant_id, 'MILEAGE_OVERAGE',           'Mileage Overage',           'Overage on the parent mileage rate',                      'overages',         'per_call',  ARRAY[]::text[],                                                         false, false, 820),
    (gen_random_uuid(), p_tenant_id, 'WINCH_OVERAGE',             'Winch Overage',             'Overage on the parent winch service',                     'overages',         'per_call',  ARRAY[]::text[],                                                         false, false, 830);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

ALTER FUNCTION fn_seed_default_service_catalog(uuid) OWNER TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION fn_seed_default_service_catalog(uuid) TO app_user, app_admin;

-- ---------- backfill existing tenants ----------
-- Production tenants (Roadside Towing today, plus any others) get the
-- catalog the moment this migration runs. New tenants land their seed
-- through the same function — see apps/api signup wiring (build 1 of 6
-- intentionally leaves the signup-time invocation as a follow-up; the
-- POST /service-catalog/seed-defaults admin endpoint covers the gap).
DO $$
DECLARE
  t record;
  inserted integer;
BEGIN
  FOR t IN SELECT id, slug FROM tenants WHERE deleted_at IS NULL LOOP
    SELECT fn_seed_default_service_catalog(t.id) INTO inserted;
    RAISE NOTICE 'service_catalog seed for tenant % (%): % rows', t.slug, t.id, inserted;
  END LOOP;
END
$$;
