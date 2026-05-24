# Secrets Rotation Runbook

_Phase 0 hardening (Session 17). Procedure for rotating each production secret,
its blast radius, and rollback. Secrets live in **Railway → service →
Variables** (per environment). Rotate on a 90-day cadence or immediately on
suspected compromise._

## General procedure

1. Generate the new secret value.
2. Set it in Railway (api and/or web service, correct environment).
3. Railway redeploys the affected service(s) with the new value.
4. Verify `/ready` is green and run a smoke check of the dependent flow.
5. Revoke the OLD value at the provider once the new deploy is confirmed
   healthy.

> **Order matters for asymmetric/secondary-capable secrets** (JWT, webhooks):
> add the new value as an accepted secondary *before* removing the old, so
> in-flight tokens/requests don't hard-fail during the cutover window.

---

## 1. JWT signing key — `JWT_SECRET`

- **What it protects:** access/refresh/MFA/driver tokens are all HKDF-derived
  from this one secret (`config.service.ts` → `jwt` getter, `::access` /
  `::refresh` / `::mfa` / `::driver` domain separation).
- **Blast radius (rotation):** **all sessions are invalidated** — every user
  (operator + driver apps) must re-authenticate. Refresh tokens minted under
  the old secret stop validating.
- **Procedure:**
  1. Generate a 32+ char random value: `openssl rand -base64 48`.
  2. Set `JWT_SECRET` in Railway (api). Redeploy.
  3. There is no dual-key window today (single canonical secret) — schedule
     rotation for a low-traffic window and expect a re-login spike.
  4. **Follow-up (🟡):** to enable zero-downtime rotation, add a
     `JWT_SECRET_PREVIOUS` accepted-on-verify path. Not implemented this
     session.
- **Rollback:** restore the previous `JWT_SECRET` value; sessions minted under
  the new key then invalidate. Keep the prior value until the new one is
  confirmed.
- **On compromise:** rotate immediately; the forced global logout is the
  containment.

## 2. Stripe — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLIC_KEY`

- **What it protects:** live payment processing + webhook authenticity.
  `PAYMENTS_PROVIDER=live` hard-fails boot if any key is missing/placeholder.
- **Blast radius:** mis-rotation breaks charges and webhook verification
  (payment status stops updating). Public key is client-exposed (low secrecy,
  still rotate the pair together).
- **Procedure:**
  1. In Stripe Dashboard → Developers → API keys, **roll** the secret key
     (Stripe supports a rollover window where both old and new work).
  2. For the webhook secret: add a new endpoint signing secret (or roll it),
     set `STRIPE_WEBHOOK_SECRET`, redeploy, confirm a test event verifies,
     then delete the old.
  3. Update `STRIPE_SECRET_KEY` / `STRIPE_PUBLIC_KEY`, redeploy api + web.
  4. Process a $1 test charge end-to-end.
- **Rollback:** revert env values during Stripe's rollover window; both keys
  remain valid until you expire the old in Stripe.
- **On compromise:** roll immediately in Stripe (revokes the old key) and
  review the Stripe event log for unauthorized charges.

## 3. SendGrid — `SENDGRID_API_KEY`

- **What it protects:** transactional + tier-offer email delivery.
- **Blast radius:** email send stops (login/verify/receipts queue or fail).
  No customer-data exposure from the key alone.
- **Procedure:**
  1. SendGrid → Settings → API Keys → create a new key (Mail Send scope).
  2. Set `SENDGRID_API_KEY` in Railway (api), redeploy.
  3. `POST /admin/email/test` (token-gated) to confirm delivery.
  4. Delete the old key in SendGrid.
- **Also rotate if affected:** `SENDGRID_WEBHOOK_PUBLIC_KEY` (event-webhook
  signature verification) — update and redeploy; unsigned events are logged.
- **Rollback:** re-create/restore the prior key; revert the env var.

## 4. Mapbox — `MAPBOX_ACCESS_TOKEN` / `NEXT_PUBLIC_MAPBOX_TOKEN`

- **What it protects:** map tiles, geocoding, directions. The web token is
  **client-exposed** by design — protect it with Mapbox URL restrictions
  (allowed referrers), not secrecy.
- **Blast radius:** maps/geocoding break; no PII exposure.
- **Procedure:**
  1. Mapbox → Account → Tokens → create a new token with the same scopes +
     URL restrictions.
  2. Update the env var(s), redeploy web (and api if the server token is set).
  3. Delete the old token.
- **Rollback:** revert the env var to the prior token before deletion.
- **On compromise:** rotate + tighten URL restrictions; review Mapbox usage
  for anomalous spend.

## 5. Sentry DSN — `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_AUTH_TOKEN`

- **What it protects:** the **DSN** is an ingest endpoint (low secrecy — it
  only allows *sending* events). The **auth token** (`SENTRY_AUTH_TOKEN`, used
  for source-map upload at build) is sensitive — it can read/write project
  data.
- **Blast radius:** wrong DSN → events silently stop (SDK is DSN-gated, so an
  empty/invalid DSN is a no-op, not a crash). Wrong/expired auth token → build
  succeeds but **source maps don't upload** (stack traces stay minified).
- **Procedure (DSN):** Sentry → Project → Client Keys (DSN) → create a new
  key, update `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`, redeploy, confirm via
  `GET /admin/sentry-test` (admin-only — throws → event must appear in Sentry).
  Disable the old key.
- **Procedure (auth token):** Sentry → Settings → Auth Tokens → create a new
  token (project:releases scope), update `SENTRY_AUTH_TOKEN` in the **build/CI**
  env, redeploy, confirm a release + source maps appear. Revoke the old token.
- **Rollback:** revert the env var; DSN rotation is non-breaking either way.

---

## Verification checklist (run after any rotation)

- [ ] `GET /ready` returns 200 (db + redis ok).
- [ ] Affected flow smoke-tested (login / charge / email / map / Sentry event).
- [ ] Old secret revoked at the provider.
- [ ] Rotation logged (date, secret, operator) in the ops journal.
