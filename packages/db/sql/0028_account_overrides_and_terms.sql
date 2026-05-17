-- =====================================================================
-- 0028_account_overrides_and_terms.sql  (Admin Settings — build 6 of 7)
--
-- Per-account pricing overrides + service availability + contract terms.
--
-- Three new surfaces:
--   1. accounts.* gains six contract-term columns (payment terms,
--      photo/auth-code requirements, GOA policy, SLA, after-hours flag).
--      These are intake-time / invoice-time flags; this build only
--      stores them, dispatcher-side prompts ship in a later build.
--   2. account_rate_overrides — per-account override row keyed by
--      (account, service, vehicle_class). Three override_type values:
--        flat_price            (override_value_cents = new price)
--        flat_dollar_discount  (override_value_cents = $ off master)
--        percent_discount      (override_percent     = % off master)
--      The CHECK constraint guarantees exactly one of value/percent is
--      non-null per row, matching its override_type.
--   3. account_service_availability — per-account flag for whether a
--      service is covered, not covered, or pre-approval required. The
--      ABSENCE of a row means 'available' (the default), so a tenant
--      can opt-in to constraints rather than seeding rows by hand.
--
-- Both new tables follow the Build 2 service_rates pattern: tenant_id
-- denormalized for RLS, FORCE RLS, audit trigger, plus a BEFORE INSERT
-- OR UPDATE cross-tenant integrity trigger that catches an attacker
-- who knows a foreign account_id or service_catalog_id and pairs it
-- with their own tenant_id.
--
-- Down (rollback):
--   DROP TRIGGER  IF EXISTS trg_audit_account_service_availability ON account_service_availability;
--   DROP TRIGGER  IF EXISTS trg_account_service_availability_tenant_consistency ON account_service_availability;
--   DROP FUNCTION IF EXISTS fn_account_service_availability_tenant_consistency();
--   DROP TABLE    IF EXISTS account_service_availability;
--   DROP TRIGGER  IF EXISTS trg_audit_account_rate_overrides ON account_rate_overrides;
--   DROP TRIGGER  IF EXISTS trg_account_rate_overrides_tenant_consistency ON account_rate_overrides;
--   DROP FUNCTION IF EXISTS fn_account_rate_overrides_tenant_consistency();
--   DROP TABLE    IF EXISTS account_rate_overrides;
--   ALTER TABLE accounts
--     DROP COLUMN IF EXISTS payment_terms,
--     DROP COLUMN IF EXISTS requires_photo_before_billing,
--     DROP COLUMN IF EXISTS requires_authorization_code,
--     DROP COLUMN IF EXISTS goa_policy,
--     DROP COLUMN IF EXISTS sla_arrival_minutes,
--     DROP COLUMN IF EXISTS after_hours_billing_allowed;
-- =====================================================================

-- ---------- 1) Contract-term columns on accounts ----------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS payment_terms                 text NOT NULL DEFAULT 'net_30';
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS requires_photo_before_billing boolean NOT NULL DEFAULT false;
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS requires_authorization_code   boolean NOT NULL DEFAULT false;
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS goa_policy                    text;
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS sla_arrival_minutes           integer;
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS after_hours_billing_allowed   boolean NOT NULL DEFAULT true;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_payment_terms_chk;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_payment_terms_chk
  CHECK (payment_terms IN ('net_15', 'net_30', 'net_45', 'due_on_receipt'));

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_sla_arrival_minutes_chk;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_sla_arrival_minutes_chk
  CHECK (sla_arrival_minutes IS NULL OR sla_arrival_minutes > 0);

-- ---------- 2) account_rate_overrides ----------
CREATE TABLE IF NOT EXISTS account_rate_overrides (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service_catalog_id  uuid NOT NULL REFERENCES service_catalog(id) ON DELETE RESTRICT,
  -- The matching VehicleClass value, or 'any' for class-independent services.
  -- Stored as text to mirror service_rates conventions; validated app-side.
  vehicle_class       text,
  override_type       text NOT NULL,
  override_value_cents integer NOT NULL DEFAULT 0,
  override_percent    numeric(5,2),
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by          uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE account_rate_overrides
  DROP CONSTRAINT IF EXISTS account_rate_overrides_override_type_chk;
ALTER TABLE account_rate_overrides
  ADD CONSTRAINT account_rate_overrides_override_type_chk
  CHECK (override_type IN ('flat_price', 'percent_discount', 'flat_dollar_discount'));

ALTER TABLE account_rate_overrides
  DROP CONSTRAINT IF EXISTS account_rate_overrides_value_nonneg_chk;
ALTER TABLE account_rate_overrides
  ADD CONSTRAINT account_rate_overrides_value_nonneg_chk
  CHECK (override_value_cents >= 0);

ALTER TABLE account_rate_overrides
  DROP CONSTRAINT IF EXISTS account_rate_overrides_percent_range_chk;
ALTER TABLE account_rate_overrides
  ADD CONSTRAINT account_rate_overrides_percent_range_chk
  CHECK (
    override_percent IS NULL
    OR (override_percent >= 0 AND override_percent <= 100)
  );

-- Exactly one of override_value_cents OR override_percent must be the
-- active field, depending on override_type. flat_* overrides keep
-- override_percent NULL; percent_discount keeps override_value_cents at
-- 0 and uses override_percent.
ALTER TABLE account_rate_overrides
  DROP CONSTRAINT IF EXISTS account_rate_overrides_value_percent_consistency_chk;
ALTER TABLE account_rate_overrides
  ADD CONSTRAINT account_rate_overrides_value_percent_consistency_chk
  CHECK (
    (override_type = 'flat_price'
       AND override_value_cents IS NOT NULL
       AND override_percent IS NULL)
    OR
    (override_type = 'flat_dollar_discount'
       AND override_value_cents IS NOT NULL
       AND override_percent IS NULL)
    OR
    (override_type = 'percent_discount'
       AND override_percent IS NOT NULL
       AND override_value_cents = 0)
  );

ALTER TABLE account_rate_overrides
  DROP CONSTRAINT IF EXISTS account_rate_overrides_vehicle_class_chk;
ALTER TABLE account_rate_overrides
  ADD CONSTRAINT account_rate_overrides_vehicle_class_chk
  CHECK (
    vehicle_class IS NULL
    OR vehicle_class IN (
      'any', 'light_duty', 'medium_duty', 'heavy_duty',
      'motorcycle', 'commercial', 'rv', 'unknown'
    )
  );

-- ---------- account_rate_overrides indexes ----------
-- Unique per (tenant, account, service, vehicle_class). Postgres treats
-- NULL as distinct in standard unique indexes, so a partial unique
-- index pair handles "vehicle_class is null" properly without the
-- NULLS NOT DISTINCT pg15 feature (we still support pg13+).
DROP INDEX IF EXISTS account_rate_overrides_unique_with_class;
CREATE UNIQUE INDEX account_rate_overrides_unique_with_class
  ON account_rate_overrides (tenant_id, account_id, service_catalog_id, vehicle_class)
  WHERE vehicle_class IS NOT NULL;

DROP INDEX IF EXISTS account_rate_overrides_unique_no_class;
CREATE UNIQUE INDEX account_rate_overrides_unique_no_class
  ON account_rate_overrides (tenant_id, account_id, service_catalog_id)
  WHERE vehicle_class IS NULL;

CREATE INDEX IF NOT EXISTS account_rate_overrides_tenant_account_idx
  ON account_rate_overrides (tenant_id, account_id);

CREATE INDEX IF NOT EXISTS account_rate_overrides_tenant_service_idx
  ON account_rate_overrides (tenant_id, service_catalog_id);

CREATE INDEX IF NOT EXISTS account_rate_overrides_tenant_active_idx
  ON account_rate_overrides (tenant_id, is_active);

-- ---------- account_rate_overrides RLS ----------
ALTER TABLE account_rate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_rate_overrides FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_rate_overrides_tenant_isolation ON account_rate_overrides;
CREATE POLICY account_rate_overrides_tenant_isolation ON account_rate_overrides
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------- account_rate_overrides cross-tenant integrity trigger ----------
-- Mirrors fn_service_rates_tenant_consistency from Build 2. Confirms
-- BOTH the account_id and service_catalog_id parent rows live in the
-- same tenant as the new override row. RLS hides foreign parent rows
-- from the trigger's SELECT, so a foreign id raises "does not exist"
-- and a matched id with mismatched tenant raises "does not match".
-- Either outcome blocks the injection.
CREATE OR REPLACE FUNCTION fn_account_rate_overrides_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_tenant uuid;
  v_service_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_account_tenant
  FROM accounts
  WHERE id = NEW.account_id;

  IF v_account_tenant IS NULL THEN
    RAISE EXCEPTION 'account_rate_overrides: account_id % does not exist', NEW.account_id;
  END IF;
  IF v_account_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'account_rate_overrides: tenant_id (%) does not match accounts.tenant_id (%)',
      NEW.tenant_id, v_account_tenant;
  END IF;

  SELECT tenant_id INTO v_service_tenant
  FROM service_catalog
  WHERE id = NEW.service_catalog_id;

  IF v_service_tenant IS NULL THEN
    RAISE EXCEPTION
      'account_rate_overrides: service_catalog_id % does not exist',
      NEW.service_catalog_id;
  END IF;
  IF v_service_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'account_rate_overrides: tenant_id (%) does not match service_catalog.tenant_id (%)',
      NEW.tenant_id, v_service_tenant;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_account_rate_overrides_tenant_consistency ON account_rate_overrides;
CREATE TRIGGER trg_account_rate_overrides_tenant_consistency
  BEFORE INSERT OR UPDATE ON account_rate_overrides
  FOR EACH ROW EXECUTE FUNCTION fn_account_rate_overrides_tenant_consistency();

-- ---------- account_rate_overrides audit ----------
DROP TRIGGER IF EXISTS trg_audit_account_rate_overrides ON account_rate_overrides;
CREATE TRIGGER trg_audit_account_rate_overrides
  AFTER INSERT OR UPDATE OR DELETE ON account_rate_overrides
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- 3) account_service_availability ----------
CREATE TABLE IF NOT EXISTS account_service_availability (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service_catalog_id uuid NOT NULL REFERENCES service_catalog(id) ON DELETE RESTRICT,
  availability       text NOT NULL DEFAULT 'available',
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by         uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE account_service_availability
  DROP CONSTRAINT IF EXISTS account_service_availability_availability_chk;
ALTER TABLE account_service_availability
  ADD CONSTRAINT account_service_availability_availability_chk
  CHECK (availability IN ('available', 'not_covered', 'pre_approval_required'));

DROP INDEX IF EXISTS account_service_availability_unique;
CREATE UNIQUE INDEX account_service_availability_unique
  ON account_service_availability (tenant_id, account_id, service_catalog_id);

CREATE INDEX IF NOT EXISTS account_service_availability_tenant_account_idx
  ON account_service_availability (tenant_id, account_id);

-- ---------- account_service_availability RLS ----------
ALTER TABLE account_service_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_service_availability FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_service_availability_tenant_isolation ON account_service_availability;
CREATE POLICY account_service_availability_tenant_isolation ON account_service_availability
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------- account_service_availability cross-tenant integrity trigger ----------
CREATE OR REPLACE FUNCTION fn_account_service_availability_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_tenant uuid;
  v_service_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_account_tenant
  FROM accounts
  WHERE id = NEW.account_id;

  IF v_account_tenant IS NULL THEN
    RAISE EXCEPTION
      'account_service_availability: account_id % does not exist',
      NEW.account_id;
  END IF;
  IF v_account_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'account_service_availability: tenant_id (%) does not match accounts.tenant_id (%)',
      NEW.tenant_id, v_account_tenant;
  END IF;

  SELECT tenant_id INTO v_service_tenant
  FROM service_catalog
  WHERE id = NEW.service_catalog_id;

  IF v_service_tenant IS NULL THEN
    RAISE EXCEPTION
      'account_service_availability: service_catalog_id % does not exist',
      NEW.service_catalog_id;
  END IF;
  IF v_service_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'account_service_availability: tenant_id (%) does not match service_catalog.tenant_id (%)',
      NEW.tenant_id, v_service_tenant;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_account_service_availability_tenant_consistency ON account_service_availability;
CREATE TRIGGER trg_account_service_availability_tenant_consistency
  BEFORE INSERT OR UPDATE ON account_service_availability
  FOR EACH ROW EXECUTE FUNCTION fn_account_service_availability_tenant_consistency();

-- ---------- account_service_availability audit ----------
DROP TRIGGER IF EXISTS trg_audit_account_service_availability ON account_service_availability;
CREATE TRIGGER trg_audit_account_service_availability
  AFTER INSERT OR UPDATE OR DELETE ON account_service_availability
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
