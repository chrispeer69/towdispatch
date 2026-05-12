-- =====================================================================
-- 0018_perf_indexes.sql
-- Phase 0 hardening: query-plan-driven indexes.
--
-- Every index below addresses a query pattern that appears in production
-- code (apps/api/src/modules/*). Each is additive — IF NOT EXISTS — so
-- replays are safe. Names are suffixed with `_p` where they are partial
-- variants of a pre-existing total index, to avoid CREATE-IF-NOT-EXISTS
-- silently skipping a real new index.
--
-- All composites lead with tenant_id so RLS-scoped scans hit them.
-- DESC ordering on created_at composites matches the canonical
-- "list latest" query that every paginated index endpoint emits.
-- =====================================================================

-- ---------- customers ----------
-- Recency list with active-row predicate. The existing
-- customers_tenant_created_idx (if any) is total; this partial complements it.
CREATE INDEX IF NOT EXISTS customers_tenant_created_active_p
  ON customers (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Phone & email lookups used by intake search, dedup, import.
CREATE INDEX IF NOT EXISTS customers_tenant_phone_active_p
  ON customers (tenant_id, phone)
  WHERE deleted_at IS NULL AND phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_tenant_email_lower_active_p
  ON customers (tenant_id, lower(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL;

-- ---------- customer_vehicles ----------
CREATE INDEX IF NOT EXISTS customer_vehicles_tenant_customer_idx
  ON customer_vehicles (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS customer_vehicles_tenant_vehicle_idx
  ON customer_vehicles (tenant_id, vehicle_id);

-- ---------- vehicles ----------
CREATE INDEX IF NOT EXISTS vehicles_tenant_created_active_p
  ON vehicles (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vehicles_tenant_vin_upper_p
  ON vehicles (tenant_id, upper(vin))
  WHERE vin IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vehicles_tenant_plate_state_p
  ON vehicles (tenant_id, plate, plate_state)
  WHERE plate IS NOT NULL AND deleted_at IS NULL;

-- ---------- jobs ----------
-- Recency board feed scoped to live jobs.
CREATE INDEX IF NOT EXISTS jobs_tenant_created_active_p
  ON jobs (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
-- Dispatch board: open jobs grouped by status, newest first.
CREATE INDEX IF NOT EXISTS jobs_tenant_status_open_p
  ON jobs (tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL AND status NOT IN ('completed', 'cancelled');
-- Driver "my jobs" — assigned, newest first.
CREATE INDEX IF NOT EXISTS jobs_tenant_driver_created_p
  ON jobs (tenant_id, assigned_driver_id, created_at DESC)
  WHERE assigned_driver_id IS NOT NULL AND deleted_at IS NULL;
-- Truck utilization history.
CREATE INDEX IF NOT EXISTS jobs_tenant_truck_created_p
  ON jobs (tenant_id, assigned_truck_id, created_at DESC)
  WHERE assigned_truck_id IS NOT NULL AND deleted_at IS NULL;
-- Service-type filter for impound queue, etc.
CREATE INDEX IF NOT EXISTS jobs_tenant_service_status_p
  ON jobs (tenant_id, service_type, status)
  WHERE deleted_at IS NULL;

-- ---------- drivers ----------
CREATE INDEX IF NOT EXISTS drivers_tenant_created_active_p
  ON drivers (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS drivers_tenant_active_only_p
  ON drivers (tenant_id, created_at DESC)
  WHERE active = true AND deleted_at IS NULL;

-- ---------- trucks ----------
CREATE INDEX IF NOT EXISTS trucks_tenant_created_active_p
  ON trucks (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------- driver_shifts ----------
CREATE INDEX IF NOT EXISTS driver_shifts_tenant_driver_started_idx
  ON driver_shifts (tenant_id, driver_id, started_at DESC);
CREATE INDEX IF NOT EXISTS driver_shifts_open_p
  ON driver_shifts (tenant_id, driver_id)
  WHERE ended_at IS NULL;

-- ---------- driver_truck_assignments ----------
CREATE INDEX IF NOT EXISTS dta_tenant_driver_started_idx
  ON driver_truck_assignments (tenant_id, driver_id, started_at DESC);
CREATE INDEX IF NOT EXISTS dta_tenant_truck_started_idx
  ON driver_truck_assignments (tenant_id, truck_id, started_at DESC);

-- ---------- invoices ----------
CREATE INDEX IF NOT EXISTS invoices_tenant_created_idx
  ON invoices (tenant_id, created_at DESC);
-- Aging: open invoices with balance > 0, sorted by due date.
CREATE INDEX IF NOT EXISTS invoices_open_aging_p
  ON invoices (tenant_id, due_at)
  WHERE status IN ('issued', 'partially_paid', 'overdue') AND balance_cents > 0;

-- ---------- invoice_line_items ----------
CREATE INDEX IF NOT EXISTS invoice_line_items_tenant_invoice_idx
  ON invoice_line_items (tenant_id, invoice_id);

-- ---------- payments ----------
CREATE INDEX IF NOT EXISTS payments_tenant_created_idx
  ON payments (tenant_id, created_at DESC);

-- ---------- documents ----------
CREATE INDEX IF NOT EXISTS documents_tenant_owner_idx
  ON documents (tenant_id, owner_type, owner_id);

-- ---------- chat_threads / chat_messages ----------
CREATE INDEX IF NOT EXISTS chat_threads_tenant_job_idx
  ON chat_threads (tenant_id, job_id);
CREATE INDEX IF NOT EXISTS chat_messages_tenant_thread_created_idx
  ON chat_messages (tenant_id, thread_id, created_at);

-- ---------- maintenance ----------
CREATE INDEX IF NOT EXISTS maintenance_schedules_tenant_due_p
  ON maintenance_schedules (tenant_id, next_due_at)
  WHERE deleted_at IS NULL;

-- ---------- tracking ----------
CREATE INDEX IF NOT EXISTS tracking_links_tenant_job_idx
  ON tracking_links (tenant_id, job_id);

-- ---------- sessions ----------
-- Active sessions list & expiry sweeper.
CREATE INDEX IF NOT EXISTS sessions_tenant_user_active_p
  ON sessions (tenant_id, user_id, last_used_at DESC)
  WHERE revoked_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_expires_active_p
  ON sessions (expires_at)
  WHERE revoked_at IS NULL AND deleted_at IS NULL;

-- ---------- accounting ----------
CREATE INDEX IF NOT EXISTS sync_jobs_tenant_status_created_idx
  ON sync_jobs (tenant_id, status, created_at DESC);

-- ---------- stripe_events ----------
CREATE INDEX IF NOT EXISTS stripe_events_created_idx
  ON stripe_events (created_at DESC);

-- ---------- import_runs / import_run_events ----------
CREATE INDEX IF NOT EXISTS import_runs_tenant_started_idx
  ON import_runs (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS import_run_events_run_occurred_idx
  ON import_run_events (run_id, occurred_at);

-- ---------- accounts ----------
CREATE INDEX IF NOT EXISTS accounts_tenant_created_active_p
  ON accounts (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------- rate_sheets ----------
CREATE INDEX IF NOT EXISTS rate_sheets_tenant_active_p
  ON rate_sheets (tenant_id)
  WHERE active = true AND deleted_at IS NULL;

-- ---------- users ----------
-- Login lookups. Email is global-unique by application logic but we don't
-- enforce that at the DB level; this is the supporting lookup.
CREATE INDEX IF NOT EXISTS users_email_lower_active_p
  ON users (lower(email))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_tenant_role_active_p
  ON users (tenant_id, role)
  WHERE deleted_at IS NULL;
