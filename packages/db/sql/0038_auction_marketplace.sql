-- =====================================================================
-- 0038_auction_marketplace.sql  (Auction & Remarketing Marketplace — Session 33)
--
-- Internal per-tenant remarketing marketplace. Vehicles cleared through
-- lien processing (Session 23) flow here: a tenant lists a vehicle, a
-- pool of registered bidders place competitive bids, and at close the
-- highest bid at or above reserve wins. Bidders authenticate against a
-- SEPARATE JWT keyspace (audience `…-bidder`) and are scoped to one
-- tenant's marketplace at a time (v1).
--
-- Tables added:
--   1. auction_bidders         — registered buyers (separate auth, per-tenant)
--   2. auction_listings        — one row per vehicle offered for bid
--   3. auction_bids            — competitive bids against a listing
--   4. auction_listing_photos  — ordered photo keys for a listing
--
-- Patterns followed (match 0036_impound_storage.sql):
--   * tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT on
--     every table.
--   * ENABLE + FORCE ROW LEVEL SECURITY, policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every table.
--   * Idempotent: CREATE ... IF NOT EXISTS; constraints/policies/triggers
--     preceded by DROP ... IF EXISTS.
--   * Soft delete (deleted_at timestamptz) everywhere — listings + bids are
--     long-lived financial/legal records.
--   * One shared BEFORE UPDATE updated_at trigger function across all four
--     tables (fn_auction_set_updated_at).
--   * Cross-tenant consistency BEFORE-trigger on every table with an FK to
--     another tenant table: RLS hides foreign parents from the SELECT, so a
--     foreign-id injection surfaces as "does not exist".
--   * Bid idempotency: unique (listing_id, bidder_id, bid_amount_cents)
--     among live rows — a double-submit of the same bid is a no-op.
--
-- S23 / S32 linkage notes:
--   * lien_case_id is a plain uuid (nullable) WITHOUT an FK constraint:
--     the lien_cases table ships in Session 23, which is not merged on this
--     branch. The column is reserved so S23 can backfill + add the FK in a
--     follow-up migration. Listing eligibility currently gates on
--     impound_records.lien_eligible (see auction.service.ts); when S23
--     merges, tighten to lien_cases.status='completed'.
--   * winning_bid_id FK is added after auction_bids exists (forward ref).
--
-- Down (rollback):
--   DROP TABLE IF EXISTS auction_listing_photos;
--   DROP TABLE IF EXISTS auction_bids;
--   DROP TABLE IF EXISTS auction_listings;
--   DROP TABLE IF EXISTS auction_bidders;
--   DROP FUNCTION IF EXISTS fn_auction_bid_consistency();
--   DROP FUNCTION IF EXISTS fn_auction_child_listing_consistency();
--   DROP FUNCTION IF EXISTS fn_auction_listing_consistency();
--   DROP FUNCTION IF EXISTS fn_auction_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all four auction tables.
CREATE OR REPLACE FUNCTION fn_auction_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Listing consistency: the optional impound_record_id, when present, must
-- belong to this listing's tenant. RLS hides foreign records, so a
-- cross-tenant impound_record_id surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_auction_listing_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_record_tenant uuid;
BEGIN
  IF NEW.impound_record_id IS NOT NULL THEN
    SELECT tenant_id INTO v_record_tenant
    FROM impound_records WHERE id = NEW.impound_record_id;
    IF v_record_tenant IS NULL THEN
      RAISE EXCEPTION 'auction_listings: impound_record_id % does not exist', NEW.impound_record_id;
    END IF;
    IF v_record_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'auction_listings: tenant_id (%) does not match impound_records.tenant_id (%)',
        NEW.tenant_id, v_record_tenant;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Photo consistency: the parent listing must belong to this row's tenant.
CREATE OR REPLACE FUNCTION fn_auction_child_listing_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_listing_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_listing_tenant
  FROM auction_listings WHERE id = NEW.listing_id;
  IF v_listing_tenant IS NULL THEN
    RAISE EXCEPTION 'auction child: listing_id % does not exist', NEW.listing_id;
  END IF;
  IF v_listing_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'auction child: tenant_id (%) does not match auction_listings.tenant_id (%)',
      NEW.tenant_id, v_listing_tenant;
  END IF;
  RETURN NEW;
END
$$;

-- Bid consistency: BOTH the parent listing and the bidder must belong to
-- this bid's tenant.
CREATE OR REPLACE FUNCTION fn_auction_bid_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_listing_tenant uuid;
  v_bidder_tenant  uuid;
BEGIN
  SELECT tenant_id INTO v_listing_tenant
  FROM auction_listings WHERE id = NEW.listing_id;
  IF v_listing_tenant IS NULL THEN
    RAISE EXCEPTION 'auction_bids: listing_id % does not exist', NEW.listing_id;
  END IF;
  IF v_listing_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'auction_bids: tenant_id (%) does not match auction_listings.tenant_id (%)',
      NEW.tenant_id, v_listing_tenant;
  END IF;

  SELECT tenant_id INTO v_bidder_tenant
  FROM auction_bidders WHERE id = NEW.bidder_id;
  IF v_bidder_tenant IS NULL THEN
    RAISE EXCEPTION 'auction_bids: bidder_id % does not exist', NEW.bidder_id;
  END IF;
  IF v_bidder_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'auction_bids: tenant_id (%) does not match auction_bidders.tenant_id (%)',
      NEW.tenant_id, v_bidder_tenant;
  END IF;
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. auction_bidders
-- ---------------------------------------------------------------------
-- Registered buyers. Separate auth from staff: argon2id password_hash +
-- a bidder JWT (audience `…-bidder`). Email verification token lives on
-- the row (rotated on consume) — no separate verification table for v1.
-- verified_at NULL = not yet verified; blocked_at NOT NULL = barred.

CREATE TABLE IF NOT EXISTS auction_bidders (
  id                            uuid PRIMARY KEY,
  tenant_id                     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name                          text NOT NULL,
  email                         text NOT NULL,
  password_hash                 text NOT NULL,
  phone                         text,
  business_name                 text,
  license_no                    text,
  verification_token            text,
  verification_token_expires_at timestamptz,
  verified_at                   timestamptz,
  blocked_at                    timestamptz,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  deleted_at                    timestamptz
);

ALTER TABLE auction_bidders DROP CONSTRAINT IF EXISTS auction_bidders_name_nonempty;
ALTER TABLE auction_bidders ADD CONSTRAINT auction_bidders_name_nonempty
  CHECK (length(trim(name)) > 0);

ALTER TABLE auction_bidders DROP CONSTRAINT IF EXISTS auction_bidders_email_nonempty;
ALTER TABLE auction_bidders ADD CONSTRAINT auction_bidders_email_nonempty
  CHECK (length(trim(email)) > 0);

-- One live bidder per (tenant, email).
DROP INDEX IF EXISTS auction_bidders_tenant_email_unique;
CREATE UNIQUE INDEX auction_bidders_tenant_email_unique
  ON auction_bidders (tenant_id, lower(email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS auction_bidders_tenant_idx
  ON auction_bidders (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE auction_bidders ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bidders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auction_bidders_tenant_isolation ON auction_bidders;
CREATE POLICY auction_bidders_tenant_isolation ON auction_bidders
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_auction_bidders ON auction_bidders;
CREATE TRIGGER trg_audit_auction_bidders
  AFTER INSERT OR UPDATE OR DELETE ON auction_bidders
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auction_bidders_set_updated_at ON auction_bidders;
CREATE TRIGGER trg_auction_bidders_set_updated_at
  BEFORE UPDATE ON auction_bidders
  FOR EACH ROW EXECUTE FUNCTION fn_auction_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. auction_listings
-- ---------------------------------------------------------------------
-- One row per vehicle offered for bid. impound_record_id links the
-- cleared impound (nullable — a listing can outlive a purged record).
-- reserve_price_cents NULL = no reserve (any bid >= starting wins at
-- close). status machine (enforced in the service layer):
--   draft -> live -> ended -> sold
--   draft|live -> withdrawn
-- winning_bid_id is set when the listing is awarded (cron or manual).

CREATE TABLE IF NOT EXISTS auction_listings (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  impound_record_id   uuid REFERENCES impound_records(id) ON DELETE SET NULL,
  lien_case_id        uuid,  -- FK added by Session 23 (lien_cases not on this branch)
  vin                 text,
  vehicle_year        integer,
  make                text,
  model               text,
  mileage             integer,
  condition_grade     text,
  reserve_price_cents bigint,
  starting_bid_cents  bigint NOT NULL DEFAULT 0,
  list_starts_at      timestamptz,
  list_ends_at        timestamptz,
  status              text NOT NULL DEFAULT 'draft',
  winning_bid_id      uuid,  -- FK to auction_bids added below
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE auction_listings DROP CONSTRAINT IF EXISTS auction_listings_status_chk;
ALTER TABLE auction_listings ADD CONSTRAINT auction_listings_status_chk
  CHECK (status IN ('draft', 'live', 'ended', 'sold', 'withdrawn'));

ALTER TABLE auction_listings DROP CONSTRAINT IF EXISTS auction_listings_condition_chk;
ALTER TABLE auction_listings ADD CONSTRAINT auction_listings_condition_chk
  CHECK (condition_grade IS NULL OR condition_grade IN ('excellent', 'good', 'fair', 'poor', 'salvage'));

ALTER TABLE auction_listings DROP CONSTRAINT IF EXISTS auction_listings_starting_nonneg;
ALTER TABLE auction_listings ADD CONSTRAINT auction_listings_starting_nonneg
  CHECK (starting_bid_cents >= 0);

ALTER TABLE auction_listings DROP CONSTRAINT IF EXISTS auction_listings_reserve_nonneg;
ALTER TABLE auction_listings ADD CONSTRAINT auction_listings_reserve_nonneg
  CHECK (reserve_price_cents IS NULL OR reserve_price_cents >= 0);

ALTER TABLE auction_listings DROP CONSTRAINT IF EXISTS auction_listings_mileage_nonneg;
ALTER TABLE auction_listings ADD CONSTRAINT auction_listings_mileage_nonneg
  CHECK (mileage IS NULL OR mileage >= 0);

ALTER TABLE auction_listings DROP CONSTRAINT IF EXISTS auction_listings_year_sane;
ALTER TABLE auction_listings ADD CONSTRAINT auction_listings_year_sane
  CHECK (vehicle_year IS NULL OR (vehicle_year >= 1900 AND vehicle_year <= 2200));

CREATE INDEX IF NOT EXISTS auction_listings_tenant_status_idx
  ON auction_listings (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS auction_listings_tenant_created_idx
  ON auction_listings (tenant_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS auction_listings_impound_idx
  ON auction_listings (impound_record_id)
  WHERE deleted_at IS NULL;

-- Cron-sweep target: live listings whose window has closed.
CREATE INDEX IF NOT EXISTS auction_listings_lifecycle_idx
  ON auction_listings (list_ends_at)
  WHERE status = 'live' AND deleted_at IS NULL;

ALTER TABLE auction_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_listings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auction_listings_tenant_isolation ON auction_listings;
CREATE POLICY auction_listings_tenant_isolation ON auction_listings
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_auction_listings_consistency ON auction_listings;
CREATE TRIGGER trg_auction_listings_consistency
  BEFORE INSERT OR UPDATE ON auction_listings
  FOR EACH ROW EXECUTE FUNCTION fn_auction_listing_consistency();

DROP TRIGGER IF EXISTS trg_audit_auction_listings ON auction_listings;
CREATE TRIGGER trg_audit_auction_listings
  AFTER INSERT OR UPDATE OR DELETE ON auction_listings
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auction_listings_set_updated_at ON auction_listings;
CREATE TRIGGER trg_auction_listings_set_updated_at
  BEFORE UPDATE ON auction_listings
  FOR EACH ROW EXECUTE FUNCTION fn_auction_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. auction_bids
-- ---------------------------------------------------------------------
-- Competitive bids. is_winning is set on exactly one bid when the
-- listing is awarded. The unique index on
-- (listing_id, bidder_id, bid_amount_cents) is the idempotency backstop
-- for a double-submit; the primary race guard is a SELECT ... FOR UPDATE
-- on the listing row in the service layer.

CREATE TABLE IF NOT EXISTS auction_bids (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  listing_id        uuid NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
  bidder_id         uuid NOT NULL REFERENCES auction_bidders(id) ON DELETE RESTRICT,
  bid_amount_cents  bigint NOT NULL,
  placed_at         timestamptz NOT NULL DEFAULT now(),
  ip_address        text,
  is_winning        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

ALTER TABLE auction_bids DROP CONSTRAINT IF EXISTS auction_bids_amount_positive;
ALTER TABLE auction_bids ADD CONSTRAINT auction_bids_amount_positive
  CHECK (bid_amount_cents > 0);

-- Bid idempotency: one live bid per (listing, bidder, amount).
DROP INDEX IF EXISTS auction_bids_idempotency_unique;
CREATE UNIQUE INDEX auction_bids_idempotency_unique
  ON auction_bids (listing_id, bidder_id, bid_amount_cents)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS auction_bids_listing_idx
  ON auction_bids (listing_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS auction_bids_tenant_bidder_idx
  ON auction_bids (tenant_id, bidder_id)
  WHERE deleted_at IS NULL;

ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auction_bids_tenant_isolation ON auction_bids;
CREATE POLICY auction_bids_tenant_isolation ON auction_bids
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_auction_bids_consistency ON auction_bids;
CREATE TRIGGER trg_auction_bids_consistency
  BEFORE INSERT OR UPDATE ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION fn_auction_bid_consistency();

DROP TRIGGER IF EXISTS trg_audit_auction_bids ON auction_bids;
CREATE TRIGGER trg_audit_auction_bids
  AFTER INSERT OR UPDATE OR DELETE ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auction_bids_set_updated_at ON auction_bids;
CREATE TRIGGER trg_auction_bids_set_updated_at
  BEFORE UPDATE ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION fn_auction_set_updated_at();

-- Forward-ref FK: listing's winning bid (added after auction_bids exists).
ALTER TABLE auction_listings DROP CONSTRAINT IF EXISTS auction_listings_winning_bid_fk;
ALTER TABLE auction_listings ADD CONSTRAINT auction_listings_winning_bid_fk
  FOREIGN KEY (winning_bid_id) REFERENCES auction_bids(id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------
-- 4. auction_listing_photos
-- ---------------------------------------------------------------------
-- Ordered photo keys (already-uploaded S3 object keys) for a listing.

CREATE TABLE IF NOT EXISTS auction_listing_photos (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  listing_id  uuid NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
  photo_key   text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

ALTER TABLE auction_listing_photos DROP CONSTRAINT IF EXISTS auction_listing_photos_key_nonempty;
ALTER TABLE auction_listing_photos ADD CONSTRAINT auction_listing_photos_key_nonempty
  CHECK (length(trim(photo_key)) > 0);

ALTER TABLE auction_listing_photos DROP CONSTRAINT IF EXISTS auction_listing_photos_sort_nonneg;
ALTER TABLE auction_listing_photos ADD CONSTRAINT auction_listing_photos_sort_nonneg
  CHECK (sort_order >= 0);

CREATE INDEX IF NOT EXISTS auction_listing_photos_listing_idx
  ON auction_listing_photos (listing_id, sort_order)
  WHERE deleted_at IS NULL;

ALTER TABLE auction_listing_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_listing_photos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auction_listing_photos_tenant_isolation ON auction_listing_photos;
CREATE POLICY auction_listing_photos_tenant_isolation ON auction_listing_photos
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_auction_photos_consistency ON auction_listing_photos;
CREATE TRIGGER trg_auction_photos_consistency
  BEFORE INSERT OR UPDATE ON auction_listing_photos
  FOR EACH ROW EXECUTE FUNCTION fn_auction_child_listing_consistency();

DROP TRIGGER IF EXISTS trg_audit_auction_listing_photos ON auction_listing_photos;
CREATE TRIGGER trg_audit_auction_listing_photos
  AFTER INSERT OR UPDATE OR DELETE ON auction_listing_photos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_auction_listing_photos_set_updated_at ON auction_listing_photos;
CREATE TRIGGER trg_auction_listing_photos_set_updated_at
  BEFORE UPDATE ON auction_listing_photos
  FOR EACH ROW EXECUTE FUNCTION fn_auction_set_updated_at();
