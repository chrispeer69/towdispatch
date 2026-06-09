# Runbook — Secrets Rotation

**Owner:** _founder + senior engineer_
**Last reviewed:** 2026-05-12

---

Every secret has: a rotation command, the files to update, the restart procedure, and the verification command. Rotate on a schedule (every 90 days for high-impact secrets) or on incident demand.

## Table of secrets

| Secret | Lives in | Impact when rotated | Section |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | API env | Every user re-logs in | §1 |
| `JWT_REFRESH_SECRET` | API env | Every refresh token invalidated | §1 |
| `JWT_MFA_SECRET` | API env | In-flight MFA challenges fail; users redo MFA | §1 |
| `TOTP_ENCRYPTION_KEY` | API env | Coordinated re-encrypt required (see §6) | §6 |
| `DATABASE_URL` password (`app_user`) | API env + DB | API restart + every replica | §2 |
| `DATABASE_ADMIN_URL` password (`towdispatch`) | Ops env | Admin tools fail until rotated everywhere | §3 |
| `STRIPE_SECRET_KEY` | API env | New charges fail until rotated; webhooks unaffected | §4 |
| `STRIPE_WEBHOOK_SECRET` | API env | Webhook deliveries fail signature check | §4 |
| `MAPBOX_SECRET_TOKEN` | Web env | Map tiles fail to load | §5 |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Web env | Map tiles fail to load | §5 |
| `SENTRY_DSN` | API + Web env | Error reporting stops; app continues | §7 |
| Agero API credentials | DB (per-tenant) | Inbound dispatch fails for that tenant | §8 |
| `QBO_CLIENT_ID` + `QBO_CLIENT_SECRET` | API env | New tenant connections fail; existing sync until tokens expire | §9 |
| Per-tenant QBO OAuth tokens | DB (encrypted) | Sync fails for that tenant; re-OAuth required | §9 |
| `QBO_TOKEN_ENCRYPTION_KEY` | API env | Coordinated re-encrypt of `accounting_connections` rows | §6 (same pattern) |
| `QBO_WEBHOOK_VERIFIER_TOKEN` | API env | QBO webhooks fail signature check | §9 |
| S3 access keys (tenant uploads) | API env | Uploads + download URL signing fail | §10 |
| `TWILIO_AUTH_TOKEN` | API env | Tracking SMS fails | §11 |
| SMTP creds | API env | Verification + reset emails fail | §11 |

---

## §1. JWT secrets

Generate 32+ random bytes, base64url-encoded:

```bash
NEW=$(openssl rand -base64 48 | tr -d '=+/' | cut -c1-48)
```

Set in the runtime environment (Railway / AWS Secrets Manager):

```bash
railway env set --service api JWT_ACCESS_SECRET="$NEW"
# or AWS: aws ssm put-parameter --name /towdispatch/prod/api/JWT_ACCESS_SECRET --value "$NEW" --overwrite
```

Update `.env.example` only if the format changed; never commit a real secret.

Restart:

```bash
railway service restart api
```

Verify — old tokens must fail, fresh login must succeed:

```bash
# Old access token: should 401
OLD_TOKEN='<token-from-pre-rotation-curl>'
curl -sf -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $OLD_TOKEN" https://api.towdispatch.com/auth/me  # → 401

# Fresh login: should 200
curl -sf -X POST https://api.towdispatch.com/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"…","password":"…"}'  # → 200 with new accessToken
```

Same procedure for `JWT_REFRESH_SECRET` and `JWT_MFA_SECRET`. Rotating refresh invalidates every active refresh token — every user must re-login (existing access tokens continue working until they age out, max 15 min).

---

## §2. `app_user` database password

The runtime DB password lives in `DATABASE_URL`. The role is `app_user`, scoped tight by RLS.

```bash
# 1. Generate
NEW=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)

# 2. Update the role on the live DB (use the admin connection)
psql "$DATABASE_ADMIN_URL" -c "ALTER ROLE app_user WITH PASSWORD '$NEW';"

# 3. Build the new DATABASE_URL — same host/db, new password
NEW_URL="postgres://app_user:$NEW@<host>:5432/towdispatch"

# 4. Set it
railway env set --service api DATABASE_URL="$NEW_URL"

# 5. Restart api (and any other consumer)
railway service restart api
```

Verify:

```bash
# `/ready` succeeds means the new password works
curl -sf https://api.towdispatch.com/ready
```

---

## §3. Admin database password

`towdispatch` (the bootstrap superuser used by `DATABASE_ADMIN_URL` for migrations and ops).

```bash
NEW=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)
psql "<old DATABASE_ADMIN_URL>" -c "ALTER ROLE towdispatch WITH PASSWORD '$NEW';"
NEW_ADMIN_URL="postgres://towdispatch:$NEW@<host>:5432/towdispatch"
railway env set --service api DATABASE_ADMIN_URL="$NEW_ADMIN_URL"
```

This password is **only** used by the admin pool inside the API process (4 connections max) and by ad-hoc psql sessions from an operator's workstation. Update both the runtime env AND your local `~/.pgpass` / 1Password entry.

---

## §4. Stripe keys

### Secret key

```bash
# 1. In the Stripe dashboard: Developers → API keys → "Roll secret key"
# 2. Update env
railway env set --service api STRIPE_SECRET_KEY="$NEW_KEY"
# 3. Restart
railway service restart api
# 4. Verify with a test charge in Stripe test mode (separate test key, not rotated)
curl -sf -X POST https://api.towdispatch.com/payments/intents \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"invoiceId":"<test-invoice-id>"}'
```

### Webhook secret

Two-step rollover because Stripe lets you have two active webhook secrets briefly:

```bash
# 1. In Stripe dashboard: add a new webhook secret to the endpoint, keep the old one active
# 2. Update API env with the new secret
railway env set --service api STRIPE_WEBHOOK_SECRET="$NEW_WHSEC"
# 3. Restart API; verify webhook deliveries with both old and new pass signature check (Stripe accepts either)
# 4. Remove the old secret from the Stripe dashboard
```

If you skip the two-step and just rotate, any webhook in flight at the rotation moment fails signature check and goes to Stripe's retry queue (Stripe retries with backoff for ~3 days, so it usually self-recovers).

### Publishable key

```bash
# Same dashboard, "Roll publishable key"
railway env set --service web NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="$NEW"
railway service restart web
```

---

## §5. Mapbox tokens

Mapbox has two: the **secret** token (used by the API for tile-server-key signing, if we move to private tiles in Phase 1) and the **public** token (loaded into the web bundle).

```bash
# 1. In Mapbox dashboard: Tokens → Create a new token with the appropriate scopes
# 2. Update env
railway env set --service web NEXT_PUBLIC_MAPBOX_TOKEN="$NEW"
railway env set --service api MAPBOX_SECRET_TOKEN="$NEW"
# 3. Rebuild + restart web (public env vars are bundled at build time)
railway service redeploy web
# 4. Delete the old token from the Mapbox dashboard
```

---

## §6. Encryption keys (TOTP_ENCRYPTION_KEY, QBO_TOKEN_ENCRYPTION_KEY)

These encrypt at-rest secrets in DB columns (`users.totp_secret_encrypted`, `accounting_connections.access_token_encrypted` + `refresh_token_encrypted`). Rotation is **coordinated** because the application must re-encrypt every affected row.

The coordinated rotation script is a **Phase 1 deliverable** (`scripts/rotate-encryption-key.ts`). Until it lands, the procedure is:

1. Schedule a maintenance window.
2. Generate `NEW_KEY`.
3. Set both `OLD_KEY` and `NEW_KEY` in the API env (the rotation script reads from `OLD_KEY` and writes to `NEW_KEY`).
4. Run the script: it decrypts each row with `OLD_KEY` and re-encrypts with `NEW_KEY` in a transaction per row.
5. Once complete, set `TOTP_ENCRYPTION_KEY=$NEW_KEY` and remove `OLD_KEY`.
6. Restart API.

For an emergency where you can't run the coordinated rotation, force every user with MFA to re-enrol (clears the `totp_secret_encrypted` column anyway) — see `docs/runbooks/security-incident.md` §3d.

---

## §7. Sentry DSN

Lower-stakes — rotation is just to rotate the project's DSN if it leaked.

```bash
# 1. In Sentry: Settings → Client Keys → reset
# 2. Update env (both API and web client SDK if/when web Sentry SDK ships in Phase 1)
railway env set --service api SENTRY_DSN="$NEW_DSN"
railway service restart api
```

Application keeps running without Sentry — the 17A SentryService no-ops when the DSN is empty.

---

## §8. Agero API credentials (per-tenant)

Agero credentials live in `tenants.motor_club_credentials.agero` (JSON). Rotated per-tenant; no global API key in this codebase.

```bash
# Per tenant — fetch from Agero partner portal, update in DB
psql "$DATABASE_ADMIN_URL" <<SQL
UPDATE tenants
SET motor_club_credentials = jsonb_set(
      motor_club_credentials,
      '{agero,api_key}',
      to_jsonb('$NEW_AGERO_KEY'::text),
      false
    ),
    updated_at = now()
WHERE slug = 'acme-towing';
SQL
```

No restart needed — the API reads credentials per-request out of the DB.

Verify with a dispatch test (see `docs/runbooks/tenant-onboarding.md` §2). Live Agero connector is Phase 1; until then this rotates the stub config.

---

## §9. QuickBooks OAuth

### Client ID + secret (global)

```bash
# 1. Intuit Developer Dashboard → keys → rotate
# 2. Update env
railway env set --service api QBO_CLIENT_ID="$NEW_ID"
railway env set --service api QBO_CLIENT_SECRET="$NEW_SECRET"
# 3. Restart
railway service restart api
```

Existing tenant OAuth tokens continue working until they expire (Intuit's access tokens live 1h, refresh tokens 100 days). New `/accounting/connect/start` calls use the new client credentials.

### Per-tenant OAuth tokens

Tokens are encrypted with `QBO_TOKEN_ENCRYPTION_KEY` and stored in `accounting_connections`. To force a tenant to re-OAuth:

```bash
psql "$DATABASE_ADMIN_URL" <<SQL
UPDATE accounting_connections
SET access_token_encrypted = NULL,
    refresh_token_encrypted = NULL,
    expires_at = now(),
    status = 'disconnected',
    updated_at = now()
WHERE tenant_id = '<uuid>';
SQL
```

The tenant's next sync attempt fails; the UI prompts them to reconnect.

### Webhook verifier

```bash
# Intuit dashboard → Webhooks → reset verifier token
railway env set --service api QBO_WEBHOOK_VERIFIER_TOKEN="$NEW"
railway service restart api
```

---

## §10. S3 access keys

S3 is used for tenant uploads (logos, job photos, signatures, import bundles).

```bash
# 1. AWS console → IAM → users → towdispatch-app-user → create new access key
# 2. Update env
railway env set --service api AWS_ACCESS_KEY_ID="$NEW_KEY"
railway env set --service api AWS_SECRET_ACCESS_KEY="$NEW_SECRET"
# 3. Restart
railway service restart api
# 4. Verify with an upload smoke test
# 5. Disable the old key in AWS console; delete after 24 hours of clean uploads
```

---

## §11. Twilio + email

### Twilio

```bash
# Twilio console → API keys → rotate
railway env set --service api TWILIO_AUTH_TOKEN="$NEW"
railway service restart api
```

Tracking SMS templates and per-tenant from-numbers are unchanged.

### SMTP / SendGrid

Currently the API uses SMTP (`SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD`). For production, SendGrid is the assumed provider:

```bash
# SendGrid: Settings → API Keys → create new (Full Access)
railway env set --service api SMTP_PASSWORD="$NEW_API_KEY"
# SMTP_USER stays as `apikey`; SendGrid SMTP relay
railway service restart api
```

Verify by triggering a password-reset email (`POST /auth/forgot-password`) and watching Mailhog (dev) or the SendGrid activity log (prod).

---

## Routine rotation schedule

| Frequency | Secrets |
|---|---|
| **Every 90 days** | JWT secrets, app_user DB password, S3 keys |
| **Every 180 days** | Encryption keys (TOTP, QBO token) — coordinated rotation |
| **Every 365 days** | Stripe keys, QBO client secret, Twilio, SendGrid |
| **On incident** | Whatever the incident scope demands — see `security-incident.md` §5 |

Log every rotation in `docs/rotation-log.md` with date + which secret + who did it.

---

## Last reviewed

2026-05-12 — Session 17C. Coordinated encryption-key rotation script is Phase 1. Routine rotation log file is Phase 1.
