# Runbook — Security Incident

**Owner:** _founder + on-call engineer_
**Last reviewed:** 2026-05-12

---

A security incident is any event suggesting unauthorized access, credential compromise, or data exfiltration. Treat every suspected breach as a SEV-1 until proven otherwise.

## 1. Triage — is this real?

### Signals that warrant escalation

| Signal | Action |
|---|---|
| Failed-login spike > 100/min on a single account | §3 lockout immediately + §4 notify founder |
| Failed-login spike > 1000/min across the platform | §3 + §5 rotate JWT secrets + §6 emergency announcement |
| RLS bypass test (`test/security/rls-bypass.spec.ts`) failing in CI | SEV-1; do not deploy; §7 forensic capture |
| `auth_lockouts_total` Prometheus counter > 50 / hour | Investigate per-user — could be brute force or could be a buggy client |
| Token-reuse-detected event in Sentry (`security_event` tag) | Already auto-handled — the entire token family was revoked. Investigate root cause |
| Unexpected admin DB connection from an unknown IP | §3 + §5 rotate `APP_ADMIN_PASSWORD` |
| Tenant reports seeing another tenant's data | SEV-1; §7 forensic capture; §6 customer notification |

### Where to look

```bash
# Recent failed logins, grouped
psql "$DATABASE_ADMIN_URL" <<'SQL'
SELECT email_hash, outcome, ip_address, COUNT(*), MIN(attempted_at), MAX(attempted_at)
FROM login_attempts
WHERE attempted_at > now() - interval '1 hour'
  AND outcome IN ('bad_password', 'unknown_user', 'mfa_failed')
GROUP BY email_hash, outcome, ip_address
HAVING COUNT(*) >= 5
ORDER BY COUNT(*) DESC;
SQL

# Recent locked-out accounts
psql "$DATABASE_ADMIN_URL" <<'SQL'
SELECT id, email, failed_login_count, lockout_streak, locked_until
FROM users
WHERE locked_until > now()
   OR (failed_login_count >= 3 AND updated_at > now() - interval '1 hour');
SQL

# Sentry: token reuse / RLS-related events
# Filter: event.tags.securityEvent:* OR event.message:"Refresh token reuse"
```

The `login_attempts` table + `lockout_streak` column landed in `packages/db/sql/0019_auth_hardening.sql`.

---

## 2. Decide — contain or observe

For an **active intrusion** (someone is logged in right now as a user they shouldn't be), contain immediately (§3). For a **failed attack** (lockouts kicked in, no successful logins from bad actors), observe + capture (§7) before rotating — you want the attacker's IPs and patterns in the log before they realize they're being watched.

---

## 3. Containment

### 3a. Revoke all active sessions

```bash
# Mark every active refresh token as revoked. Access tokens (JWTs) survive
# until their 15-min TTL expires; no way to revoke those before TTL unless
# we ship a JWT denylist (Phase 1 enhancement).
psql "$DATABASE_ADMIN_URL" <<'SQL'
UPDATE sessions
SET revoked_at = now(), updated_at = now()
WHERE revoked_at IS NULL
  AND deleted_at IS NULL;
SQL
```

Effect: every refresh attempt fails. Every user must re-login. The 15-min window before all access tokens age out is the residual risk — rotate `JWT_ACCESS_SECRET` (§5) to close it instantly.

### 3b. Revoke a single user's sessions

```bash
# By email
psql "$DATABASE_ADMIN_URL" <<'SQL'
UPDATE sessions s
SET revoked_at = now(), updated_at = now()
FROM users u
WHERE s.user_id = u.id
  AND lower(u.email) = lower('jane@acme.com')
  AND s.revoked_at IS NULL;
SQL
```

### 3c. Revoke an entire token family (token reuse detected)

The 17B `sessions.family_id` column lets a single UPDATE revoke a lineage:

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
UPDATE sessions
SET revoked_at = now(), updated_at = now()
WHERE family_id = '<the-family-uuid-from-the-Sentry-event>'
  AND revoked_at IS NULL;
SQL
```

The application's reuse detector already does this automatically (`apps/api/src/modules/auth/auth.service.ts` token reuse path). Run the manual version only if Sentry shows the auto-revoke fired and additional families need clearing.

### 3d. Force MFA re-enrollment for a user

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
UPDATE users
SET mfa_enabled = false,
    totp_secret_encrypted = NULL,
    updated_at = now()
WHERE lower(email) = lower('jane@acme.com');
SQL
```

The 17B enforcement gate then blocks the user from getting access tokens until they re-enroll via `/settings/security/mfa/enroll`.

### 3e. Lock an account hard

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
UPDATE users
SET locked_until = now() + interval '24 hours',
    failed_login_count = 999,
    updated_at = now()
WHERE lower(email) = lower('jane@acme.com');
SQL
```

---

## 4. Notify

| Audience | Channel | When |
|---|---|---|
| Founder | Phone + SMS + email | Immediately on any §1 signal |
| Affected tenant owners | Email from `security@towdispatch.com` | After containment, before public statement |
| Public | Status page + blog post | After scope is known (typically 24–72 hours) |
| Regulators | Email per applicable law | Per §6 |

---

## 5. Secrets rotation (emergency path)

Full rotation procedures with verification commands live in `docs/runbooks/secrets-rotation.md`. The emergency-order priorities:

1. **JWT_ACCESS_SECRET + JWT_REFRESH_SECRET** — invalidates every access token in flight (every active user must re-login).
2. **DATABASE_URL password** for `app_user` — closes the runtime DB attack surface.
3. **APP_ADMIN_PASSWORD** (the bootstrap superuser) — only if admin SQL is the suspected path.
4. **STRIPE_SECRET_KEY** — rotates in the Stripe dashboard; webhook secret rotates with it.
5. **QBO_CLIENT_SECRET** + every tenant's QBO OAuth tokens (re-OAuth required per tenant).
6. **TOTP_ENCRYPTION_KEY** — only rotate with a coordinated re-encrypt of `users.totp_secret_encrypted`. Migration not in this codebase yet; see `docs/runbooks/secrets-rotation.md` §6.
7. **S3 access keys** for the tenant uploads bucket.
8. **TWILIO_AUTH_TOKEN** + **SENDGRID_API_KEY** — communication channels.

Do **not** rotate everything at once unless the incident scope demands it. Each rotation is a small outage (token-invalidate forces re-login; DB rotation requires service restart).

---

## 6. Customer notification

Triggers depend on what was accessed:

- **Customer PII (names, phones, emails):** state breach-notification laws (CA, NY, etc.) require notification within 60–90 days. Use the template in §8a.
- **Payment data:** PCI-DSS notification. Our Stripe Connect architecture means we never see raw card numbers — but if a Stripe Connect account was compromised, notify the tenant owner immediately and Stripe via their security email (security@stripe.com).
- **Driver / employee data:** same as customer PII; some states distinguish.
- **No data accessed, only attempted access:** no statutory notification required. Internal post-mortem.

### 6a. Customer notification template

Drafted with placeholder fields; legal review required before sending in any real incident.

```
SUBJECT: Important security notice from Tow Dispatch

[Tenant Owner Name],

We are writing to inform you of a security incident that affected
Tow Dispatch on [DATE]. We discovered [SCOPE] and contained it within
[DURATION].

What happened:
[plain language, 2 sentences max]

What information was involved:
[specific list — names, phones, addresses, etc.]

What we did:
[specific containment steps — revoked sessions, rotated secrets, etc.]

What you should do:
- Review your Tow Dispatch activity log for the past 30 days.
- If you re-use passwords across services (you shouldn't!), change them.
- Watch for phishing attempts using your Tow Dispatch-associated email.

What we are doing going forward:
[concrete improvements; do not promise anything you won't actually do]

We take this seriously and we are sorry. If you have questions, reach
us at security@towdispatch.com or call [phone].

— Chris Peer, Founder
```

---

## 7. Forensic capture

Before you change anything beyond containment, capture:

```bash
# Snapshot the audit log for the relevant window
psql "$DATABASE_ADMIN_URL" -c "
COPY (
  SELECT * FROM audit_log
  WHERE created_at BETWEEN '<window-start>' AND '<window-end>'
) TO STDOUT WITH CSV HEADER" > /tmp/audit-snapshot-$(date -u +%FT%T).csv

# Snapshot login_attempts
psql "$DATABASE_ADMIN_URL" -c "
COPY (
  SELECT * FROM login_attempts
  WHERE attempted_at BETWEEN '<window-start>' AND '<window-end>'
) TO STDOUT WITH CSV HEADER" > /tmp/login-attempts-$(date -u +%FT%T).csv

# Snapshot sessions
psql "$DATABASE_ADMIN_URL" -c "
COPY (
  SELECT * FROM sessions WHERE created_at > '<window-start>'
) TO STDOUT WITH CSV HEADER" > /tmp/sessions-$(date -u +%FT%T).csv

# Tar + upload to a write-once bucket
tar czf /tmp/incident-$(date -u +%F).tar.gz /tmp/*.csv
aws s3 cp /tmp/incident-$(date -u +%F).tar.gz \
  s3://towdispatch-incidents/$(date -u +%F)/$(uuidgen).tar.gz \
  --acl bucket-owner-full-control
```

The `towdispatch-incidents` bucket is configured with object lock + 7-year retention (Phase 1 prerequisite). Files retained per legal hold.

---

## 8. Post-incident

File the post-mortem (template in `docs/runbooks/incident-response.md` §5). Required additions for security incidents:

- **Timeline of attacker actions** based on `audit_log` + `login_attempts`
- **Indicators of compromise** (IPs, user agents, request signatures)
- **What logged in successfully and from where** (`audit_log` JOIN `users` JOIN `sessions`)
- **Detection gaps** — what should have alerted but didn't
- **Remediation status** — every secret rotated, every account re-MFA'd, every patched code path

---

## 9. Brute-force lockout — automated path (reference)

The application already handles brute force per-account:

- 5 failed logins in 15 minutes → 15-minute lockout
- Each consecutive lockout doubles the duration up to 24 hours (`lockout_streak` column, 0019)
- All attempts logged to `login_attempts`

If the attacker rotates emails (credential stuffing), the per-account lockout doesn't help. The 17A rate limiter (per-IP + per-tenant + per-token) kicks in at the controller layer. PagerDuty page fires when `auth_lockouts_total > 50/hour`. At that point follow §3 and consider §5.1 (rotate JWT secrets to force universal re-login as a circuit-breaker).

---

## Last reviewed

2026-05-12 — Session 17C. RLS, audit log, login_attempts, lockout_streak, and Sentry security-event tagging are all live. Object-lock bucket for forensic captures is Phase 1.
