# TowCommand — System Inventory

**Purpose:** This is the TowCommand half of a cross-app inventory. The owner runs four apps (TowCommand, Convini, US Dispatch, US Tow AI Connect) that will eventually integrate. Manus + Sidd will map this against the other three inventories to decide system boundaries (monorepo vs separate, shared DB vs separate, sync vs async). This document describes **only** TowCommand, and only what is **grep-verifiable on `master` HEAD `0715834`** as of 2026-05-24. Features built on open PRs but not yet merged are flagged explicitly in §7 and §9, not presented as shipped.

> **Naming note:** The product is branded **US Tow DISPATCH** in code and production (rebrand in Session 20). "TowCommand" is the repo/internal name. They refer to the same app.

---

## 1. App identity

| Field | Value |
|---|---|
| Internal name | TowCommand (repo) |
| Product name | US Tow DISPATCH |
| Owner | Chris Peer (sole owner) |
| Repo | `chrispeer69/towcommand` (monorepo, pnpm workspaces) |
| Production domain | `ustowdispatch.com` (operator console + API) |
| Ops domain | `ustowdispatch.cloud` (ops contact / region hostnames, e.g. `api-west.ustowdispatch.cloud`) |
| Hosting | Railway |
| API stack | Node 20+/22 LTS · NestJS (Fastify adapter) · Drizzle ORM + raw SQL · PostgreSQL 16 + PostGIS · Redis 7 + BullMQ · Pino · Zod · Vitest |
| Web stack | Next.js 15 (App Router) — operator console |
| Mobile | Native iOS (Swift) + Android (Kotlin/Compose) driver apps |
| Auth | Custom JWT + rotating refresh tokens, argon2id hashing (no Auth0/Clerk) |
| IDs | UUIDv7 only |

**Source:** `README.md`, `ARCHITECTURE.md`, `apps/api/src/config/config.schema.ts`, `package.json`, `pnpm-workspace.yaml`.

---

## 2. Runtime topology

### Services in production (Railway)
- **`api`** — NestJS/Fastify monolith. Single deployable; all domain modules co-located.
- **`web`** — Next.js 15 operator console (server + client components).
- **Cron** — runs **in-process inside `api`** via NestJS schedulers. There is **no separate worker service**. Crons are individually env-gated (all default OFF except as noted):
  - `DYNAMIC_PRICING_CRON_ENABLED` — NOAA weather poll, demand-surge sampler, auto-revert.
  - `TIER_OFFER_CRON_ENABLED` — tier-offer lifecycle (5-min tick).
  - `IMPOUND_FEE_CRON_ENABLED` — daily storage-fee accrual (02:00).
  - `LIEN_ADVANCE_CRON_ENABLED` — nightly lien sweep (03:00), **observation-only**.
  - `HD_CERT_EXPIRY_CRON_ENABLED` — daily HD cert-expiry sweep (04:00), observation-only.
  - RED ALERT A/R digest cron (Monday 06:00) — Moat #1, live.

### Hosting & regions
- **Single primary region today** (`us-east`). Session 44 shipped a **multi-region foundation** (PR #107, merged): `REGION_ID` / `REGION_ROLE` config, optional read-replica pool (`DATABASE_READ_URL`), and a write-guard that returns `503` + `Location` header on the secondary. It is **not true active-active** — Railway's managed Postgres caps this at primary + read replicas. A secondary is activated by setting `REGION_ID=us-west`, `REGION_ROLE=secondary`. `tenants.preferred_region` exists.

### External infrastructure
| Dependency | Role | Required to boot? |
|---|---|---|
| PostgreSQL 16 + PostGIS | Primary datastore (`DATABASE_URL`) | Yes |
| Redis 7 | Socket.IO pub/sub adapter + BullMQ (`REDIS_URL`) | Yes |
| S3 (or MinIO/R2) | Job evidence storage (`S3_BUCKET`) | No — local-disk/stub fallback |
| SendGrid | Transactional email (`SENDGRID_API_KEY`) | No — SMTP/mailhog fallback |
| Stripe | Payments (`STRIPE_*`, `PAYMENTS_PROVIDER`) | No — stub provider default |
| QuickBooks Online | Accounting sync (`QBO_*`) | No — stub provider default |
| Twilio | Tracking SMS (`TWILIO_*`) | No — stub if creds absent |
| Mapbox | Maps/geocoding (`MAPBOX_ACCESS_TOKEN`, web-primary) | No |
| Sentry | Error telemetry (`SENTRY_DSN`) | No |
| Datadog | Optional alternate to Sentry (`DD_API_KEY`) | No — off by default |
| NOAA / OpenWeatherMap | Dynamic-pricing weather signal | No — cron-gated |

**Source:** `apps/api/src/config/config.schema.ts`, `ARCHITECTURE.md`, `SESSION_44_REPORT.md`.

---

## 3. Domain entity inventory

Walked every directory under `apps/api/src/modules/`. **"Public-API-exposed"** here means *reachable over any REST endpoint at all* — TowCommand has **no third-party public API surface on master** (the S29 public API + API-key realm live on an unmerged branch; see §7/§9), so every "yes" below is an operator/driver-authenticated REST route, not a developer-facing API. **"Audit-logged"** = the module owns at least one `FORCE ROW LEVEL SECURITY` table covered by the trigger-driven `audit_log` (`packages/db/sql/0004_audit_trigger.sql`). All entities are sourced **in this app** unless noted.

| Module | Primary entities / tables | Purpose | Tenant-scoped | REST-exposed | Audit-logged |
|---|---|---|---|---|---|
| `auth` | `users`, `sessions`, `password_reset_tokens`, `email_verification_tokens`, `user_invites`, `driver_pins`; global: `login_attempts`, `login_alert_emails_sent` | Login, refresh-token rotation, MFA (TOTP, gated), invites, driver PINs | Yes (tenant rows) | Yes | Yes |
| `users` | `users` (management surface) | Staff user CRUD, role assignment, yard scoping | Yes | Yes | Yes |
| `tenants` | `tenants`, `tenant_default_rate_sheets`, `tenant_activation_events`, company code | Tenant root (the RLS partition key); provisioning | Partition root | Yes | Yes |
| `onboarding` | `onboarding_progress`, `tenant_activation_events` | Self-serve signup → activation flow | Yes | Yes | Yes |
| `customers` | `customers`, `customer_vehicles` | Cash / account / motor-club customers | Yes | Yes | Yes |
| `vehicles` | `vehicles`, `customer_vehicles` | Vehicle records | Yes | Yes | Yes |
| `accounts` | `accounts`, `account_mappings` | Commercial accounts, billing terms, credit | Yes | Yes | Yes |
| `account-rate-cards` | `account_rate_overrides`, `account_service_availability` | Per-account rate overrides + service availability | Yes | Yes | Yes |
| `jobs` | `jobs`, `job_number_sequences`, `job_ratings`, `job_status_transitions` | Tow job lifecycle (intake → complete) | Yes | Yes | Yes |
| `dispatch` | `job_driver_assignments`, `job_status_transitions` | Live dispatch board, assignment, realtime fan-out | Yes | Yes (+ WebSocket) | Yes |
| `tracking` | `tracking_links`, `tracking_messages` | Customer-facing tracking links + SMS (Twilio) | Yes | Yes (public link) | Yes |
| `chat` | `chat_threads`, `chat_messages` | Dispatcher ↔ driver / customer chat | Yes | Yes | Yes |
| `fleet` | `trucks`, `drivers`, `driver_shifts`, `driver_truck_assignments`, `dvirs`, `maintenance_records`, `maintenance_schedules`, `documents` | Trucks, drivers, DVIR, maintenance, doc expirations | Yes | Yes | Yes |
| `driver-experience` | `job_evidence`, `job_field_payments`, `driver_offline_actions`, `driver_daily_briefings`, `driver_briefing_acknowledgments`, `driver_pretrip_inspections`, `driver_telemetry_events` | Driver-app BFF: evidence (S3), offline outbox, briefings, telemetry | Yes | Yes (driver JWT) | Yes |
| `billing` | `invoices`, `invoice_line_items`, `invoice_taxes`, `invoice_line_commissions`, `credit_memos`, `recurring_billing_schedules`, `statement_sends`, `invoice_number_sequences` | Invoicing, taxes, commissions, statements, recurring | Yes | Yes | Yes |
| `ar` | A/R views over `invoices` + `red_alert_sends` | A/R aging, statements, RED ALERT cron, invoice defaults | Yes | Yes | Yes |
| `payments` | `payments`; global: `stripe_events` | Payment intents, card-on-file, Stripe webhook (stub/live) | Yes | Yes (+ webhook) | Yes |
| `accounting` | `accounting_connections`, `account_mappings`, `sync_jobs` | QuickBooks Online sync (stub default), mapping editor | Yes | Yes (+ webhook) | Yes |
| `rates` | `rate_sheets` (read), `rate-engine.service` | Rate computation engine | Yes | Internal | Via rate_sheets |
| `service-catalog` | `service_catalog` | Tenant service definitions | Yes | Yes | Yes |
| `service-rates` | `service_rates` | Per-service rate config | Yes | Yes | Yes |
| `dynamic-pricing` | `dynamic_pricing_curves/tiers/overrides/holiday_calendar/noaa_mappings/demand_surge_suggestions/pulse_daily/tier_activations`, `invoice_line_dynamic_pricing_audit` | Moat #1: multi-variable surge pricing (NOAA/OWM) | Yes | Yes | Yes |
| `tier-offers` | `tier_offers`, `tier_offer_recipients` | Moat #3: tier-offer composer + SendGrid event webhook | Yes | Yes (+ webhook) | Yes |
| `impound` | `impound_records`, `impound_yards`, `impound_holds`, `impound_fees`, `impound_releases` | Impound/storage yard lifecycle + daily fee accrual | Yes | Yes | Yes |
| `lien-processing` | `lien_cases`, `lien_notices`, `lien_timeline_events`; global: `lien_state_rules` | State-driven lien workflow (observation-only cron) | Yes | Yes | Yes |
| `heavy-duty` | `hd_truck_capabilities`, `hd_driver_certifications`, `hd_job_attributes`, `hd_rate_sheets` | Class 7/8 recovery layer (caps/certs/rate-sheets) | Yes | Yes | Yes |
| `ev-recovery` | `ev_job_attributes`, `ev_thermal_events`, `ev_charge_station_visits`; global: `ev_oem_procedures` | EV-aware recovery (flatbed-only, thermal, OEM lookup) | Yes | Yes (driver `/driver-ev`) | Yes |
| `import` | `import_runs`, `import_run_events` | Towbook data importer | Yes | Yes | Yes |
| `reporting` | `report_runs`, `report_schedules`, `saved_reports` | Standard A/R + compliance reports (Excel/PDF) | Yes | Yes | Yes |
| `dashboard` | (read-only aggregation) | Operator dashboard rollups | Yes (scoped reads) | Yes | N/A |
| `directions` | (no table) | Routing / distance (Mapbox-backed) | Yes (scoped) | Internal | N/A |
| `email` | (transport) | SendGrid/SMTP email transport | N/A | Admin-only test | N/A |
| `storage` | (transport) | StorageProvider abstraction (local disk / S3) | N/A | Internal | N/A |
| `redis` | (infra) | Redis client + Socket.IO pub/sub adapter | N/A | Internal | N/A |
| `health` | (no table) | `/health`, `/ready`, region-block readiness | N/A | Yes (probes) | N/A |
| `debug` | (no table) | Guarded `/_debug/boom` smoke endpoint | N/A | Gated | N/A |
| `shared-contracts` | (none — DTO contract tests only) | Job-DTO contract test fixture | N/A | N/A | N/A |

**Source:** directory walk of `apps/api/src/modules/`, table list from `packages/db/sql/*.sql` (`grep FORCE ROW LEVEL SECURITY`).

---

## 4. Auth realms

Auth is custom JWT (no external IdP). Tokens are domain-separated by **audience** off a single `JWT_SECRET` (HKDF-style suffixing). On `master` HEAD there are **two operational realms plus dormant MFA tokens**:

| Realm | Audience | TTL | Notes |
|---|---|---|---|
| **Operator (staff)** | `ustowdispatch-api` | access 15m / refresh 30d | Console users; 7 built-in RBAC roles (`packages/shared/src/constants/roles.ts`). Refresh tokens stored hashed in `sessions`, rotated on use. |
| **Driver app** | `ustowdispatch-api-driver` | 12h | Domain-separated secret (`JWT_DRIVER_SECRET`, else derived). Sized to a wrecker shift; expires before an overnight-in-truck device is reusable. |
| **MFA setup / challenge** | `…-api-mfa-setup` / `…-api-mfa` | short | Issued only when `MFA_LOGIN_GATE_ENABLED=true` (default **false**). Endpoints mounted but dormant by default. |

**Isolation guarantees:** A leaked operator-token oracle cannot mint driver tokens (different audience + secret), and vice-versa. All realms still resolve to a tenant and run inside the RLS transaction.

> **Planned realms not on master (built on open PRs — see §9):** Customer-Portal JWT (S32, PR #104), Bidder JWT (S33 auction, PR #105), and the public-API API-Key realm (S29). **None are merged to master HEAD `0715834`**; there is no `api_keys` table in `packages/db/sql/`. They are documented here as planned scope, not as shipped surface.

**Source:** `apps/api/src/modules/auth/jwt.service.ts` (audience lines 61–174), `config.schema.ts`, merge log, MEMORY.md.

---

## 5. Tenant model

- **"Tenant" = one towing company.** Shared-database, shared-schema multi-tenancy. `tenants` is the partition root; every tenant table carries `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT`.
- **Enforcement = PostgreSQL RLS.** ~100 tables carry `FORCE ROW LEVEL SECURITY` (not just `ENABLE` — `FORCE` so the table owner can't bypass). The app connects as the non-superuser role `app_user`. `app_admin` is reserved for ops tooling.
- **Context propagation:** every DB-touching request opens a transaction and runs `SET LOCAL app.current_tenant_id = '<uuid>'` (+ `app.current_user_id`). RLS policies key off `current_setting('app.current_tenant_id')`. Bypass is regression-tested (`apps/api/test/security/rls-bypass.spec.ts`).
- **Audit:** trigger-driven `audit_log` captures before/after on INSERT/UPDATE/DELETE for tenant tables (`0004_audit_trigger.sql`). Soft-delete (`deleted_at`) everywhere; no hard delete from app code.
- **Cross-tenant / global reference tables (NOT tenant-scoped):**
  - `lien_state_rules` — per-US-state statutory lien rules (reference data).
  - `ev_oem_procedures` — global EV OEM recovery procedures (reference data).
  - `stripe_events` — webhook idempotency ledger.
  - `login_attempts`, `login_alert_emails_sent` — auth security infra (keyed by email, not tenant).

**Source:** `ARCHITECTURE.md §3`, `packages/db/sql/0003_rls_policies.sql`, `0004_audit_trigger.sql`, global-table diff (`comm -23` of CREATE-TABLE vs FORCE-RLS lists).

---

## 6. Data flow surfaces

### Inbound
- **Operator REST** — authenticated console endpoints across all modules (NestJS controllers).
- **Driver REST** — driver-JWT endpoints (`driver-experience`, `ev-recovery` `/driver-ev`).
- **Public tracking link** — unauthenticated, token-bearing customer tracking page (`tracking-public.controller`).
- **Webhooks (inbound):** Stripe (`payments`), QuickBooks Online (`accounting`), SendGrid event webhook (`tier-offers`). These are integration callbacks, **not** a generic third-party webhook surface.
- **No third-party public API** on master. No customer portal / marketplace inbound on master (those are unmerged — §9).

### Outbound
- **SendGrid** — transactional + tier-offer emails (SMTP/mailhog fallback in dev).
- **Stripe** — checkout / payment intents / Connect (stub provider unless `PAYMENTS_PROVIDER=live`).
- **QuickBooks Online** — accounting sync (sandbox/stub default).
- **Twilio** — tracking SMS.
- **Mapbox** — geocoding / routing (web-primary).
- **NOAA / OpenWeatherMap** — dynamic-pricing weather signal.
- **Sentry** (+ optional Datadog) — error/telemetry export.
- **No outbound webhook delivery service** on master (S29 webhook delivery is unmerged).

### Internal events — **in-process only, not a bus**
Domain events are emitted via an **in-process EventEmitter** (`DispatchEventsService.emit(tenantId, name, payload)`) and re-broadcast by `DispatchGateway` to the **tenant-scoped Socket.IO room**, fanned out horizontally through the **Redis adapter**. The canonical event names (`packages/shared/src/schemas/dispatch-events.ts` → `DISPATCH_EVENTS`):

```
job.created            job.assigned         job.unassigned       job.status_changed
driver.location_changed  driver.shift_started  driver.shift_ended  driver.status_changed
tracking.link_created   tracking.link_updated  tracking.link_viewed  tracking.message_received
```

> **Integration-critical fact:** There is **no durable event store, transactional outbox, or cross-service event bus**. Events are ephemeral realtime notifications scoped to one running `api` process cluster. Any cross-app (TowCommand ↔ Convini / US Dispatch / US Tow AI Connect) event integration would require building that durable layer — it does not exist today.

**Source:** `apps/api/src/modules/dispatch/dispatch-events.service.ts`, `dispatch.gateway.ts`, `packages/shared/src/schemas/dispatch-events.ts`.

---

## 7. External integrations status

| Integration | Status on master | Gate / evidence |
|---|---|---|
| **Stripe** | Wired; **stub by default**, live cutover behind a flag | `PAYMENTS_PROVIDER` (`stub`\|`live`); live boot hard-fails on placeholder keys |
| **SendGrid** | **Live path** (prefers API key, SMTP fallback) | `SENDGRID_API_KEY` |
| **Mapbox** | **Live** (web-primary; token accepted on backend) | `MAPBOX_ACCESS_TOKEN` |
| **Sentry** | **Live** (DSN-gated) | `SENTRY_DSN`, `RELEASE_TAG` |
| **Twilio (SMS)** | Wired; stub if creds absent | `TWILIO_*` |
| **QuickBooks Online** | **Sandbox/stub** (live cutover pending) | `QBO_*`, `QBO_SANDBOX=true` default |
| **NOAA / OpenWeatherMap** | Wired; cron-gated | `DYNAMIC_PRICING_CRON_ENABLED` |
| **Datadog** | Optional alternate to Sentry; off | `DD_API_KEY` |
| **Motor clubs (Agero + others)** | **Parked** — Agero stub only (`motor_club_dispatches`); Allstate/Honk/AAA/Urgently/etc. none | S13/S18–21/S28/S30/S34 |
| **Plate-to-VIN, telematics, accounting (beyond QBO), SSO, marketplace API** | **Parked** — not started | S24/S26/S27/S38/S39/S46 |

> **Built but NOT merged to master HEAD `0715834`** (on open PRs / feature branches; do not treat as deployed): Public REST API + API-key realm (**S29**), SOC 2 Type I controls (**S31**), Customer/White-Label Portal (**S32, PR #104**), Auction Marketplace + Bidder realm (**S33, PR #105**), Photo Damage Analysis (**S42, PR #110**), Fraud Detection (**S43, PR #109**), DOT/FMCSA recordkeeping (**S37, PR #112**), SOC 2 Type II + PCI L1 (**S40**). Confirmed absent from master by grep (`auction`/`portal`/`public-api`/`bidder`/`fmcsa` → 0 module files). The integration team should treat these as *planned*, not *available*.

**Source:** `config.schema.ts`, merge log (`git log --merges`), worktree list, MEMORY.md, `BUILD_STATUS_2026-05-17.md §1` (noting that doc predates several merges — see §9).

---

## 8. Compliance posture

- **Audit log retention:** trigger-driven `audit_log` on every tenant table; soft-delete (`deleted_at`) everywhere; UUIDv7 identifiers. 7-year retention is the stated target.
- **RLS bypass test** is a CI-gated control (`apps/api/test/security/rls-bypass.spec.ts`).
- **Security incident runbook:** `docs/runbooks/security-incident.md`; security test suite under `apps/api/test/security/`.
- **SOC 2 Type I (S31)** and **SOC 2 Type II + PCI L1 (S40)** — the formal controls/evidence packages are **on unmerged branches, not on master HEAD**. On master, the only compliance artifacts are the incident runbook and the security test directory above. The "compliance reporter" present on master (`apps/api/src/modules/reporting/reports/compliance.reporter.ts`) is an **operational A/R/fleet compliance report**, not a SOC 2 controls module.
- **DOT / FMCSA recordkeeping (S37)** — built on PR #112, **not merged to master**.

**Source:** `docs/runbooks/security-incident.md`, `apps/api/test/security/`, reporting module grep, MEMORY.md (`project_soc2*`, `project_dot_compliance`).

---

## 9. Build phase status (as of `master` HEAD `0715834`)

The repo's `BUILD_STATUS_2026-05-17.md` audits against a 57-page build report but is **stale** — it predates the merges of impound (#97/#106 lineage), lien processing (#106), multi-region (#107), heavy-duty (#108), and EV recovery (#111). Its §4.9/§4.10 ("impound / lien not started") is **no longer true** on current master. Current reality:

| Phase | Shipped on master | In-PR / not merged |
|---|---|---|
| **Phase 0** (replace Towbook for the founder) | ✅ Operator console end-to-end: auth/RBAC/RLS, intake, dispatch board (Socket.IO), fleet, drivers, customers, accounts, jobs, invoicing, A/R + statements + RED ALERT, Towbook importer, iOS/Android driver shells, green E2E | — |
| **Phase 1** | ✅ Stripe scaffold (stub→live flag), QBO stub, dynamic pricing (Moat #1), tier offers (Moat #3), self-serve onboarding | 🟡 Public REST API/webhooks/OAuth (S29); SOC 2 Type I (S31); 3 live motor clubs (only Agero stub) |
| **Phase 2** | ✅ Impound & storage yard, lien processing (50-state engine, observation-only cron), reporting | 🟡 Customer/white-label portal (S32 #104), DOT/FMCSA (S37 #112) |
| **Phase 3** | ✅ Multi-region foundation (S44), heavy-duty (S36), EV recovery (S48) | 🟡 Auction & remarketing marketplace (S33 #105), fraud detection (S43 #109), photo damage analysis (S42 #110) |
| **Phase 4 (compliance/scale)** | 🟡 RLS/audit/soft-delete invariants live; security runbook + tests | 🟡 SOC 2 Type II + PCI L1 (S40); Stripe + QBO live cutover |

**Migration record:** `packages/db/sql/0001…0042` on master (0040 heavy-duty, 0042 EV recovery). Gaps (0041, 0043, 0044) land on un-merged branches and are harmless — `migrate.ts` re-applies all idempotent SQL each run; contiguity is reconciled at merge (per MEMORY `project_migration_numbering`).

**Source:** `BUILD_STATUS_2026-05-17.md` (qualified as stale), merge log, `packages/db/sql/`, MOAT_LIST.md.

---

## 10. Open questions for cross-app integration design

*(Left unanswered by design — these are for the owner + Sidd + Manus. TowCommand-side facts that constrain each are noted, but the decision is theirs.)*

1. **Shared user identity?** Should a TowCommand operator/driver be the *same* identity record as in Convini / US Dispatch / US Tow AI Connect, or per-app? — *Constraint: TowCommand uses custom JWT off a single `JWT_SECRET`, no external IdP. There is no SSO/OIDC on master.*
2. **Tenant ID concept — shared or per-app?** Is a "tenant" the same entity across all four apps, or does each app define its own? — *Constraint: TowCommand's `tenant_id` is the RLS partition key on ~100 tables with `ON DELETE RESTRICT`; changing its meaning is a deep schema commitment.*
3. **Source-of-truth ownership.** Which entities should TowCommand own vs. defer to another app (customers? vehicles? invoices? drivers?)? — *Constraint: today TowCommand is sole source-of-truth for all its entities.*
4. **Real-time vs batch sync.** Which cross-app data needs realtime propagation vs nightly batch? — *Constraint: TowCommand has only in-process realtime events and no durable outbox/bus (see §6); any sync layer is greenfield.*
5. **Shared infrastructure vs per-app.** One DB cluster / auth provider / event bus across all four, or isolated per app? — *Constraint: TowCommand is Postgres+Redis on Railway, single-primary with a multi-region foundation but not active-active.*
6. **Observability consolidation.** Unify logging/telemetry (Sentry/Datadog/Pino) across apps, or keep per-app? — *Constraint: TowCommand exports to Sentry (Datadog optional), Pino structured logs, with PII redaction as an invariant.*

---

*Generated for cross-app integration planning. Every entity, env var, event name, and integration above is grep-verifiable against `master` HEAD `0715834`. Unmerged scope is flagged as such, not presented as shipped.*
