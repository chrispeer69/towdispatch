-- Convinicar Integration: add linkage columns + indexes
-- Adds the vendor mapping to tenants, and the offer/request tracking to jobs.

-- 1. tenants: map each USTD tenant to a Convinicar vendor
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS convinicar_vendor_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_convinicar_vendor_idx
  ON tenants (convinicar_vendor_id)
  WHERE convinicar_vendor_id IS NOT NULL;

-- 2. jobs: track which Convinicar service_request and tow_offer a job came from
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS convinicar_service_request_id UUID;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS convinicar_offer_id UUID;
CREATE INDEX IF NOT EXISTS jobs_tenant_convinicar_idx
  ON jobs (tenant_id, convinicar_service_request_id)
  WHERE convinicar_service_request_id IS NOT NULL;
