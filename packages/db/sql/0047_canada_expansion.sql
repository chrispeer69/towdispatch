-- Migration 0047 — Canada Expansion (Session 47)
--
-- Adds the foundation for serving Canadian towing operators alongside US ones:
--   1. tenant localization columns (country, locale, currency, unit system)
--   2. per-user locale preference (the only auth/user-model change this session)
--   3. jurisdictions  — global reference: country + state/province lookup
--   4. tax_rules      — global reference: GST/HST/PST/QST/sales-tax rates
--
-- DESIGN NOTES
--
-- * tax_rules is GLOBAL reference data (NOT tenant-scoped, no RLS), the same
--   convention as lien_state_rules (0038). Statutory tax rates are public and
--   identical for every operator in a jurisdiction. A nullable
--   tenant_override_id column is reserved so a future session can let a tenant
--   pin a custom rate; v1 seeds ONLY base rows (tenant_override_id IS NULL).
--   Because the table is non-RLS, any future override insertion must be scoped
--   to the current tenant in the application layer.
--
-- * rate_bps is numeric (not integer) on purpose. Quebec's QST is 9.975%, which
--   is 997.5 basis points — not representable as an integer. numeric keeps every
--   rate exact (HST 13% = 1300, QST 9.975% = 997.5).
--
-- * Idempotent / re-runnable: ADD COLUMN guarded by DO blocks, CREATE TABLE IF
--   NOT EXISTS, partial-unique-index + ON CONFLICT upserts for the seed rows.
--   The tenants/users audit triggers (0004) are to_jsonb(NEW) column-agnostic,
--   so new columns are safe.
--
-- * 2026 rate source: Canada Revenue Agency GST/HST rate table + provincial
--   finance ministries (QST: Revenu Québec; PST: BC/SK/MB). Nova Scotia HST is
--   14% (reduced from 15% effective 2025-04-01). Rates require finance review
--   before production billing; refresh strategy is to add a superseding row with
--   a new effective_at and stamp the old row's expires_at (see DECISIONS).

-- ---------------------------------------------------------------------
-- 1. tenants — localization columns
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'country') THEN
    ALTER TABLE tenants ADD COLUMN country text NOT NULL DEFAULT 'US';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'default_locale') THEN
    ALTER TABLE tenants ADD COLUMN default_locale text NOT NULL DEFAULT 'en-US';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'default_currency') THEN
    ALTER TABLE tenants ADD COLUMN default_currency text NOT NULL DEFAULT 'USD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'default_unit_system') THEN
    ALTER TABLE tenants ADD COLUMN default_unit_system text NOT NULL DEFAULT 'imperial';
  END IF;
END$$;

-- Format checks (forward-compatible: ISO 3166-1 alpha-2 / BCP-47 / ISO 4217),
-- except unit_system which is a closed two-value set.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_country_format;
ALTER TABLE tenants ADD CONSTRAINT tenants_country_format
  CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_locale_format;
ALTER TABLE tenants ADD CONSTRAINT tenants_locale_format
  CHECK (default_locale ~ '^[a-z]{2}-[A-Z]{2}$');
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_currency_format;
ALTER TABLE tenants ADD CONSTRAINT tenants_currency_format
  CHECK (default_currency ~ '^[A-Z]{3}$');
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_unit_system_values;
ALTER TABLE tenants ADD CONSTRAINT tenants_unit_system_values
  CHECK (default_unit_system IN ('imperial', 'metric'));

COMMENT ON COLUMN tenants.country IS
  'Canada Expansion (S47): ISO 3166-1 alpha-2 country (US|CA). Drives postal validation, tax engine, default formatting.';
COMMENT ON COLUMN tenants.default_locale IS
  'Canada Expansion (S47): BCP-47 default locale (en-US|en-CA|fr-CA). Top of the locale-resolution chain; user preference overrides.';
COMMENT ON COLUMN tenants.default_currency IS
  'Canada Expansion (S47): ISO 4217 currency (USD|CAD). Money is stored in cents; currency is presentation only.';
COMMENT ON COLUMN tenants.default_unit_system IS
  'Canada Expansion (S47): imperial|metric. Distance is stored canonical (miles); unit system is presentation only.';

-- ---------------------------------------------------------------------
-- 2. users — locale preference (overrides tenant default for this user)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'locale_preference') THEN
    ALTER TABLE users ADD COLUMN locale_preference text;
  END IF;
END$$;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_preference_format;
ALTER TABLE users ADD CONSTRAINT users_locale_preference_format
  CHECK (locale_preference IS NULL OR locale_preference ~ '^[a-z]{2}-[A-Z]{2}$');

COMMENT ON COLUMN users.locale_preference IS
  'Canada Expansion (S47): per-user BCP-47 locale override. NULL = inherit tenant.default_locale.';

-- ---------------------------------------------------------------------
-- shared updated_at trigger fn for this migration's reference tables
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_canada_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------
-- 3. jurisdictions  (GLOBAL reference data — NOT tenant-scoped)
-- ---------------------------------------------------------------------
-- Country + state/province lookup. Seeded with Canada's 10 provinces and 3
-- territories. US states stay app-side (usStateSchema) and can be backfilled
-- here later. name_fr carries the Canadian-French label for fr-CA surfaces.
CREATE TABLE IF NOT EXISTS jurisdictions (
  country     text NOT NULL,
  code        text NOT NULL,
  name_en     text NOT NULL,
  name_fr     text NOT NULL,
  type        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country, code)
);

ALTER TABLE jurisdictions DROP CONSTRAINT IF EXISTS jurisdictions_country_format;
ALTER TABLE jurisdictions ADD CONSTRAINT jurisdictions_country_format
  CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE jurisdictions DROP CONSTRAINT IF EXISTS jurisdictions_type_values;
ALTER TABLE jurisdictions ADD CONSTRAINT jurisdictions_type_values
  CHECK (type IN ('state', 'province', 'territory'));

DROP TRIGGER IF EXISTS trg_jurisdictions_set_updated_at ON jurisdictions;
CREATE TRIGGER trg_jurisdictions_set_updated_at
  BEFORE UPDATE ON jurisdictions
  FOR EACH ROW EXECUTE FUNCTION fn_canada_set_updated_at();

INSERT INTO jurisdictions (country, code, name_en, name_fr, type) VALUES
  ('CA', 'ON', 'Ontario', 'Ontario', 'province'),
  ('CA', 'QC', 'Quebec', 'Québec', 'province'),
  ('CA', 'BC', 'British Columbia', 'Colombie-Britannique', 'province'),
  ('CA', 'AB', 'Alberta', 'Alberta', 'province'),
  ('CA', 'MB', 'Manitoba', 'Manitoba', 'province'),
  ('CA', 'SK', 'Saskatchewan', 'Saskatchewan', 'province'),
  ('CA', 'NS', 'Nova Scotia', 'Nouvelle-Écosse', 'province'),
  ('CA', 'NB', 'New Brunswick', 'Nouveau-Brunswick', 'province'),
  ('CA', 'NL', 'Newfoundland and Labrador', 'Terre-Neuve-et-Labrador', 'province'),
  ('CA', 'PE', 'Prince Edward Island', 'Île-du-Prince-Édouard', 'province'),
  ('CA', 'YT', 'Yukon', 'Yukon', 'territory'),
  ('CA', 'NT', 'Northwest Territories', 'Territoires du Nord-Ouest', 'territory'),
  ('CA', 'NU', 'Nunavut', 'Nunavut', 'territory')
ON CONFLICT (country, code) DO UPDATE
  SET name_en = EXCLUDED.name_en, name_fr = EXCLUDED.name_fr,
      type = EXCLUDED.type, updated_at = now();

-- ---------------------------------------------------------------------
-- 4. tax_rules  (GLOBAL reference data — NOT tenant-scoped)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country            text NOT NULL,
  region             text,                       -- state/province; NULL = country-wide
  tax_type           text NOT NULL,              -- sales_tax|gst|hst|pst|qst
  name_en            text NOT NULL,
  name_fr            text NOT NULL,
  rate_bps           numeric(9,4) NOT NULL,      -- basis points; numeric for QST 9.975% = 997.5
  display_order      smallint NOT NULL DEFAULT 0,
  effective_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,                -- NULL = currently in effect
  tenant_override_id uuid REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = base rate
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tax_rules DROP CONSTRAINT IF EXISTS tax_rules_country_format;
ALTER TABLE tax_rules ADD CONSTRAINT tax_rules_country_format
  CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE tax_rules DROP CONSTRAINT IF EXISTS tax_rules_type_values;
ALTER TABLE tax_rules ADD CONSTRAINT tax_rules_type_values
  CHECK (tax_type IN ('sales_tax', 'gst', 'hst', 'pst', 'qst'));
ALTER TABLE tax_rules DROP CONSTRAINT IF EXISTS tax_rules_rate_nonneg;
ALTER TABLE tax_rules ADD CONSTRAINT tax_rules_rate_nonneg
  CHECK (rate_bps >= 0);

-- One active base row per (country, region, tax_type). Enables idempotent
-- ON CONFLICT upsert and prevents duplicate base rates. Tenant overrides and
-- expired (historical) rows are excluded from the uniqueness guarantee.
DROP INDEX IF EXISTS tax_rules_base_unique;
CREATE UNIQUE INDEX tax_rules_base_unique
  ON tax_rules (country, region, tax_type)
  WHERE tenant_override_id IS NULL AND expires_at IS NULL;

CREATE INDEX IF NOT EXISTS tax_rules_lookup_idx
  ON tax_rules (country, region) WHERE expires_at IS NULL;

DROP TRIGGER IF EXISTS trg_tax_rules_set_updated_at ON tax_rules;
CREATE TRIGGER trg_tax_rules_set_updated_at
  BEFORE UPDATE ON tax_rules
  FOR EACH ROW EXECUTE FUNCTION fn_canada_set_updated_at();

-- Seed 2026 Canadian rates. Each jurisdiction fully enumerates its tax lines
-- (no cross-row "federal GST applies everywhere" inference): HST provinces get
-- one HST line; GST+PST/QST provinces get a GST line plus a provincial line;
-- AB and the territories get GST only. display_order keeps GST above the
-- provincial component on rendered invoices.
INSERT INTO tax_rules (country, region, tax_type, name_en, name_fr, rate_bps, display_order) VALUES
  -- HST provinces (single combined line)
  ('CA', 'ON', 'hst', 'HST', 'TVH', 1300, 1),
  ('CA', 'NB', 'hst', 'HST', 'TVH', 1500, 1),
  ('CA', 'NL', 'hst', 'HST', 'TVH', 1500, 1),
  ('CA', 'NS', 'hst', 'HST', 'TVH', 1400, 1),   -- 14% since 2025-04-01
  ('CA', 'PE', 'hst', 'HST', 'TVH', 1500, 1),
  -- GST-only (no provincial sales tax)
  ('CA', 'AB', 'gst', 'GST', 'TPS', 500, 1),
  ('CA', 'YT', 'gst', 'GST', 'TPS', 500, 1),
  ('CA', 'NT', 'gst', 'GST', 'TPS', 500, 1),
  ('CA', 'NU', 'gst', 'GST', 'TPS', 500, 1),
  -- GST + provincial (PST/QST), GST first
  ('CA', 'QC', 'gst', 'GST', 'TPS', 500, 1),
  ('CA', 'QC', 'qst', 'QST', 'TVQ', 997.5, 2),
  ('CA', 'BC', 'gst', 'GST', 'TPS', 500, 1),
  ('CA', 'BC', 'pst', 'PST', 'TVP', 700, 2),
  ('CA', 'SK', 'gst', 'GST', 'TPS', 500, 1),
  ('CA', 'SK', 'pst', 'PST', 'TVP', 600, 2),
  ('CA', 'MB', 'gst', 'GST', 'TPS', 500, 1),
  ('CA', 'MB', 'pst', 'RST', 'TVD', 700, 2)
ON CONFLICT (country, region, tax_type) WHERE tenant_override_id IS NULL AND expires_at IS NULL
  DO UPDATE SET
    name_en = EXCLUDED.name_en, name_fr = EXCLUDED.name_fr,
    rate_bps = EXCLUDED.rate_bps, display_order = EXCLUDED.display_order,
    updated_at = now();
