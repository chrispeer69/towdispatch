# Runbook — Payment Processor (Stripe) Degraded

**Owner:** _on-call engineer + AR lead_
**Last reviewed:** 2026-05-12

---

Stripe is the only payment processor in this codebase today (Session 11). When it's degraded, card payments don't work; cash collection continues unaffected.

## 1. Detect

### 1a. Stripe status

Stripe publishes its status at https://status.stripe.com. The 17A observability layer's Sentry hook captures `StripeAPIError` events under the `apps/api/src/modules/payments/stripe.provider.ts` tag — those route to PagerDuty SEV-2.

### 1b. Locally

```bash
# Sentry filter:
#   event.tags.module:"payments"
#   event.tags.outcome:"stripe_error"
#   age:-15m

# Recent failed PaymentIntent creates:
psql "$DATABASE_ADMIN_URL" <<'SQL'
SELECT id, tenant_id, status, last_error, created_at
FROM payments
WHERE status = 'failed'
  AND last_error IS NOT NULL
  AND created_at > now() - interval '15 minutes'
ORDER BY created_at DESC
LIMIT 20;
SQL
```

### 1c. Webhook delivery health

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
-- Webhooks received recently
SELECT event_type, COUNT(*) AS n, MAX(created_at) AS last_seen
FROM stripe_events
WHERE created_at > now() - interval '30 minutes'
GROUP BY event_type
ORDER BY last_seen DESC;
SQL
```

If `last_seen` for `payment_intent.succeeded` is > 10 min behind real time on a normally-busy tenant, webhook delivery is degraded.

---

## 2. Fallback — cash collection

The platform always supports cash. When Stripe is degraded, dispatchers tell drivers to collect cash; the driver app records the payment as `paymentMethod=cash`. Cash payments don't depend on Stripe at all.

### 2a. Operator comms

Send to dispatch-ops + drivers (Slack + SMS):

```
SUBJECT: Card payments degraded — collect cash for the next hour

Stripe is experiencing elevated errors. For the next hour:

1. Quote the customer the full amount.
2. Collect cash at drop-off.
3. Record in the driver app: "Cash collected: $XXX".
4. Card-on-file customers: still tap "Charge card" — the system will
   retry automatically once Stripe recovers. Tell them their card will
   be charged within 24 hours.

— TowCommand operations
```

### 2b. Card-on-file customers — automatic retry

The Session 11 payments service already retries `payment_intent.requires_action` and `payment_intent.processing` via the webhook handler. Failed intents get a `last_error` field set and surface in `/billing/payments` for the AR lead to follow up.

---

## 3. Replay failed charges after recovery

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
-- Charges that need retry: failed during the incident window, customer
-- still owes money, last_error is a Stripe-side error code (not a
-- card-decline)
SELECT p.id, p.tenant_id, p.invoice_id, p.amount_cents, p.last_error
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE p.status = 'failed'
  AND p.created_at BETWEEN '<incident-start>' AND '<incident-end>'
  AND i.balance_cents > 0
  AND p.last_error NOT ILIKE '%card_declined%'
  AND p.last_error NOT ILIKE '%insufficient_funds%';
SQL
```

For each row, call the retry endpoint:

```bash
curl -sS -X POST "https://api.towcommand.cloud/billing/payments/$PAYMENT_ID/retry" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

(The retry endpoint is a Phase 1 deliverable that wraps `payments.service.ts retry()`. Until it ships, the AR lead recreates the charge through the regular `/billing/invoices/<id>` flow.)

---

## 4. Webhook backfill

If Stripe delivers webhooks out of order or repeats during recovery:

- The `stripe_events` table has a unique constraint on `stripe_event_id` (see `packages/db/sql/0014_stripe_payments.sql`). Replays are idempotent at the DB level.
- The webhook handler verifies `Stripe-Signature` before persisting (`apps/api/src/modules/payments/payments-webhook.controller.ts`).
- For a manual backfill: pull events from the Stripe dashboard for the incident window and replay them through `stripe-cli webhook replay <event_id>`.

---

## 5. Last-resort: manual reconciliation

If Stripe's Connect platform itself loses data (very rare; only seen once in the platform's history), the operations lead reconciles tenant-by-tenant against Stripe's exported CSV. The query that gives you the "money the platform thinks each tenant collected" is:

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
SELECT t.slug,
  SUM(p.amount_cents) FILTER (WHERE p.payment_method = 'cash') / 100.0 AS cash_collected_usd,
  SUM(p.amount_cents) FILTER (WHERE p.payment_method = 'card') / 100.0 AS card_collected_usd,
  COUNT(*) FILTER (WHERE p.status = 'failed') AS failed_count
FROM payments p
JOIN tenants t ON t.id = p.tenant_id
WHERE p.created_at >= '<window-start>'
GROUP BY t.slug;
SQL
```

---

## Last reviewed

2026-05-12 — Session 17C. Stripe Connect (Session 11) is the active provider. Retry endpoint is Phase 1.
