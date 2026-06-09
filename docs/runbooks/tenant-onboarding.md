# Runbook — Tenant Onboarding

**Owner:** _founder / customer success_
**Last reviewed:** 2026-05-12

---

Onboards a new towing company onto Tow Dispatch. Run this top-to-bottom; total time should be < 30 minutes once integrations are pre-approved.

## 1. Provision the tenant + first OWNER user

The canonical path is the `/signup` endpoint, which creates a tenant + OWNER user + idempotently triggers verification mail in a single transaction. There is no admin SQL for "create a tenant" because doing so bypasses the integrity guards in `AuthService.signup()` (`apps/api/src/modules/auth/auth.service.ts`).

```bash
curl -sS -X POST https://api.towdispatch.com/auth/signup \
  -H 'content-type: application/json' \
  -d '{
    "tenantName": "Acme Towing & Recovery, Inc.",
    "tenantSlug": "acme-towing",
    "ownerName": "Jane Owner",
    "ownerEmail": "jane@acme-towing.com",
    "password": "TempPass-RotateAt-Login-9!"
  }'
```

Response on success:

```json
{
  "status": "authenticated",
  "user": { "id": "<uuid>", "email": "..." },
  "tenant": { "id": "<uuid>", "slug": "acme-towing" },
  "accessToken": "...",
  "refreshToken": "..."
}
```

Capture both UUIDs — you'll need them below.

> **Slug rules:** lowercase alphanumeric + hyphens, 3–60 chars, globally unique. The DB enforces this; signup returns 409 with `code=CONFLICT` if the slug is taken.

### 1a. Email verification

`AuthService.signup()` queues a verification email immediately. The link expires after 24 hours (`VERIFY_TOKEN_TTL_HOURS = 24` in `auth.service.ts`).

If the email never arrives (Twilio/SendGrid degraded — see `docs/runbooks/secrets-rotation.md`), force-verify via admin SQL:

```bash
psql "$DATABASE_ADMIN_URL" <<SQL
UPDATE users
SET email_verified_at = now(), updated_at = now()
WHERE email = 'jane@acme-towing.com';
SQL
```

### 1b. MFA enrolment (mandatory for OWNER/ADMIN)

The 17B MFA enforcement gate (see `apps/api/SESSION_17B_ADDENDUM.md`) blocks OWNER/ADMIN login until MFA is enrolled. On first login the user receives `status='mfa_setup_required'` and a `setupToken`. They scan a QR code at `/settings/security/mfa/enroll` and verify a TOTP code. Walk them through this on the onboarding call.

---

## 2. Configure motor club credentials

Currently only **Agero** is supported (live integration ships in Phase 1; Session 16 covers historical import; Session 17B added the in-memory stub provider). The credentials live in the `tenants.motor_club_credentials` JSON column (per-tenant) so different tenants can run different Agero contracts.

```bash
psql "$DATABASE_ADMIN_URL" <<SQL
UPDATE tenants
SET motor_club_credentials = jsonb_set(
      COALESCE(motor_club_credentials, '{}'::jsonb),
      '{agero}',
      '{"contract_id":"REPLACE-WITH-AGERO-CONTRACT","api_key":"REPLACE","environment":"production"}'::jsonb,
      true
    )
WHERE slug = 'acme-towing';
SQL
```

Verify the inbound dispatch path with the stub:

```bash
curl -sS -X POST https://api.towdispatch.com/motor-club/agero/dispatch \
  -H 'content-type: application/json' \
  -d "$(cat <<JSON
{
  "tenantId": "<the-tenant-uuid>",
  "externalId": "TEST-$(date +%s)",
  "service": "tow",
  "customer": { "name": "Smoke Test", "phone": "+13105550100" },
  "pickup": { "address": "100 Test St", "lat": 40.72, "lng": -74.0 }
}
JSON
)"
```

The dispatch should land on the dispatch board for the target tenant within 2 seconds.

---

## 3. Configure Stripe Connect

Each tenant gets its own Stripe Connect Express account (see Session 11).

1. From the admin console (Phase 1) or directly via API:

```bash
# Start onboarding — returns a Stripe-hosted onboarding URL
curl -sS -X POST https://api.towdispatch.com/payments/connect/start \
  -H "Authorization: Bearer $TENANT_OWNER_ACCESS_TOKEN" \
  -H 'content-type: application/json'
```

2. Email the returned URL to the tenant owner. They complete Stripe's KYC + bank-account verification (this can take 1–3 days for first-time Connect accounts).

3. Verify connection:

```bash
curl -sS https://api.towdispatch.com/payments/connect/status \
  -H "Authorization: Bearer $TENANT_OWNER_ACCESS_TOKEN"
# Expect: { "connected": true, "chargesEnabled": true, "payoutsEnabled": true }
```

If `chargesEnabled=false` after 24 hours: nudge the owner to finish Stripe's verification. Until then, the tenant runs cash-only.

---

## 4. Configure QuickBooks Online

QBO connection is per-tenant OAuth (Session 12).

1. Send the tenant owner to `https://app.towdispatch.com/accounting` from the web app.
2. They click "Connect QuickBooks" → completes Intuit OAuth → lands back on the mapping screen.
3. Owner maps each Tow Dispatch category to a QBO Chart-of-Accounts entry:
   - **Tow revenue** → QBO income account (typically "Towing Income")
   - **Accessorial revenue** → QBO income account
   - **Cash collected** → QBO bank/clearing account
   - **Stripe deposits** → QBO bank account
   - **Tax payable** → QBO liability account

The mapping UI is at `/accounting/mapping`. Required mappings are flagged; sync won't fire until every required category is mapped.

4. Trigger a backfill sync:

```bash
curl -sS -X POST https://api.towdispatch.com/accounting/sync/manual \
  -H "Authorization: Bearer $TENANT_OWNER_ACCESS_TOKEN"
```

Status visible at `/accounting/settings` and `GET /accounting/sync-status`.

---

## 5. Branding upload

Logos and brand color are per-tenant.

1. Owner navigates to `/settings/branding` (Phase 1 — until that page lands, set via SQL):

```bash
psql "$DATABASE_ADMIN_URL" <<SQL
UPDATE tenants
SET logo_url = 'https://towdispatch-tenants.s3.amazonaws.com/<tenant-id>/logo.png',
    brand_color = '#F05A1A',
    updated_at = now()
WHERE slug = 'acme-towing';
SQL
```

2. Upload the logo file to S3 with the tenant-isolated prefix:

```bash
aws s3 cp ./acme-logo.png \
  s3://towdispatch-tenants/<tenant-id>/logo.png \
  --acl private \
  --metadata tenant-id=<tenant-id>
```

The web app pulls logos via signed URL (the S3 ACL is `private`; the API mints a 1-hour signed URL on every page load).

---

## 6. Verify tenant isolation

This step is **non-negotiable**. Run before letting the tenant log a single real customer.

### 6a. RLS bypass test against the new tenant

```bash
# From any developer machine with DB + Redis up
E2E_RUN_REQUIRES_STACK=1 \
  pnpm --filter @towdispatch/api test test/security/rls-bypass.spec.ts
```

The test seeds two synthetic tenants and verifies cross-tenant access fails on every record-by-id endpoint. A clean pass against the new tenant validates that RLS policies took effect.

### 6b. Manual cross-tenant probe (if RLS is in any doubt)

```bash
# As the new tenant's OWNER
NEW_TOKEN=$(curl -sS -X POST https://api.towdispatch.com/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"jane@acme-towing.com","password":"..."}' | jq -r .accessToken)

# Try to fetch a known-good record from ANOTHER tenant (use a record id you
# know exists in tenant-002, e.g. Auto Lyft, from your seed data)
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $NEW_TOKEN" \
  https://api.towdispatch.com/customers/<auto-lyft-customer-id>
```

**Must return 404.** Not 403, not 200. If 200 — STOP, this is a SEV-1, see `docs/runbooks/security-incident.md`.

---

## 7. Smoke test — full workflow

The new tenant owner walks through this checklist on the onboarding call:

```
[ ] Log in at https://app.towdispatch.com — lands on dashboard
[ ] Click "Settings → Users", invite a dispatcher (sends verification email)
[ ] Click "Fleet → Drivers", create a driver
[ ] Click "Fleet → Trucks", create a truck
[ ] Click "Intake", create a tow job (cash customer):
    - phone: +1310-555-0001
    - name: Test Customer
    - vehicle: 2020 Toyota Camry, VIN 1HGCM82633A123456
    - service: Tow
    - pickup: 100 Onboarding Test St
[ ] Switch to "Dispatch" — job appears in the queue
[ ] Drag the job onto the driver — toast confirms "Job assigned"
[ ] Simulate driver progress via the API (or the iOS app if installed):
    POST /jobs/<id>/status {"status":"enroute"}
    POST /jobs/<id>/status {"status":"on_scene"}
    POST /jobs/<id>/status {"status":"in_progress"}
    POST /jobs/<id>/status {"status":"completed"}
[ ] Click "Billing → Invoices" — invoice generated from the completed job
[ ] Click "Take payment" → enter Stripe test card 4242 4242 4242 4242
[ ] Invoice status flips to "paid"
[ ] If QBO is connected: visit /accounting/sync-status — confirm the
    invoice + payment land in the recent-syncs feed
```

If every box is checked, the tenant is live.

---

## 8. Hand-off

- Owner receives a one-pager with: dashboard URL, status page, support email, on-call phone (for SEV-1 only).
- Owner adds at least one ADMIN-role colleague so the company is never single-point-of-failure on the OWNER account.
- Schedule a 30-day check-in: data hygiene, MFA enrolment, billing reconciliation walk-through.

---

## Decommissioning a tenant

Soft-delete only. See the `deleted_at` column on `tenants` — setting it cascades through the application via `WHERE deleted_at IS NULL` filters on every list endpoint. RLS still allows the rows to exist; physical purge after 90 days is a Phase 1 scheduled job.
