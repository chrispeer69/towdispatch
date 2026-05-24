# Stripe Stub → Live Cutover Runbook

Operator runbook for flipping US Tow DISPATCH payments from the in-memory stub
provider to real Stripe charges. The codebase already ships the real provider
(`StripePaymentProvider`); cutover is a **single env flag** plus the keys it
guards.

> Default posture is `PAYMENTS_PROVIDER=stub`. Nothing charges real cards until
> you complete the steps below.

---

## 1. What the flag does

`PAYMENTS_PROVIDER` (parsed in `config.schema.ts`, exposed as
`ConfigService.payments.provider`) selects the provider in `payments.module.ts`:

| Value          | Behavior                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `stub` (default) | In-memory `StubPaymentProvider`. Stripe keys are ignored. Safe for dev, CI, tests.              |
| `live`           | Real `StripePaymentProvider`. **The API refuses to boot** unless keys + webhook secret are real. |

In `live` mode there is **no silent fallback** to the stub. If a key is missing
or the webhook secret is a placeholder, boot throws with an explicit error. This
is deliberate: a silent fallback in production would accept "payments" that
never reach Stripe — money never moves and there is no signal. Fail loud.

---

## 2. Environment variables

Set all of these in the production environment (Railway/Render/Fly secrets — do
NOT commit them):

| Var                     | Required for live | Notes                                                                 |
| ----------------------- | ----------------- | --------------------------------------------------------------------- |
| `PAYMENTS_PROVIDER`     | yes               | Set to `live`. This is the cutover switch.                            |
| `STRIPE_SECRET_KEY`     | yes               | Platform secret key. `sk_live_…` for production.                      |
| `STRIPE_PUBLIC_KEY`     | yes               | Publishable key `pk_live_…`. Served to the public `/pay/[token]` page. |
| `STRIPE_WEBHOOK_SECRET` | yes               | `whsec_…` from the dashboard webhook endpoint (step 3). Must NOT contain `session11`/`default`/`example`/`placeholder`/`changeme` or boot is refused. |

Boot guards (enforced in `selectPaymentProvider`):

- `STRIPE_SECRET_KEY` + `STRIPE_PUBLIC_KEY` present and not containing `missing`.
- `STRIPE_WEBHOOK_SECRET` starts with `whsec_` and is not a known placeholder.
- A `sk_test_` key IS allowed in `live` mode so you can rehearse the cutover
  against a staging deploy / Stripe test mode before using `sk_live_`.

---

## 3. Register the webhook endpoint (Stripe Dashboard)

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**.
2. Endpoint URL: `https://<API_PUBLIC_URL>/webhooks/stripe`
   (the route is `PaymentsWebhookController`, `POST /webhooks/stripe`, public —
   the raw body is preserved by `registerRawBodyJsonParser` for HMAC checking).
3. Events to send (minimum the app handles): `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `charge.dispute.created`. (Add account /
   payout events as needed.)
4. Copy the **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

---

## 4. Cutover steps

1. **Pre-flight on staging** — deploy with `PAYMENTS_PROVIDER=live` and
   `sk_test_` keys + a test-mode webhook secret. Confirm the boot log line:
   `PaymentsModule: using StripePaymentProvider (LIVE)` with `livemode:false`.
2. **Optional live SDK test pass** — run the gated spec against test mode:
   `STRIPE_TEST_SECRET_KEY=sk_test_xxx pnpm --filter @ustowdispatch/api test`
   (covers webhook signature verify + Connect account creation; add
   `STRIPE_TEST_CONNECTED_ACCOUNT=acct_xxx` for a destination charge + refund).
3. **Tenant onboarding** — each tenant must complete Stripe Connect onboarding
   (`POST /payments/connect/start` → onboarding link → `…/connect/sync`) so
   `charges_enabled` is true before they can be paid.
4. **Set production secrets** — `sk_live_…`, `pk_live_…`, the production
   `whsec_…`, and `PAYMENTS_PROVIDER=live`.
5. **Deploy / restart.** Watch the boot log for the LIVE line with
   `livemode:true`. If keys are wrong the process exits on boot — that's the
   guard working; fix the secret and redeploy.
6. **Smoke test** — issue a small real invoice, pay it on `/pay/[token]` with a
   real card, confirm: payment row `cleared`, invoice `paid`, webhook 200, and
   the funds land on the tenant's connected account (minus platform margin).

---

## 5. Verify the live provider actually booted

- Boot log: `PaymentsModule: using StripePaymentProvider (LIVE)` — absence means
  you're still on the stub.
- A test charge produces a `pi_…` (not `pi_stub_…`) payment intent id and a real
  `ch_…`/`re_…` for charges/refunds.
- Stripe Dashboard shows the payment and the webhook delivery as 200.

---

## 6. Rollback

Fast, single-step, no code change:

1. Set `PAYMENTS_PROVIDER=stub` (or unset it — default is `stub`).
2. Redeploy / restart the API.
3. Boot log returns to `PaymentsModule: using StubPaymentProvider`.

The Stripe keys can stay set; in `stub` mode they're ignored. In-flight Stripe
payment intents already created remain valid in Stripe — reconcile any pending
charges from the Stripe Dashboard before/after rollback. Rolling back does NOT
refund anything; issue refunds explicitly via `POST /billing/payments/:id/refund`
while still in `live` mode if a charge must be reversed.

---

## 7. Notes / known items

- `STRIPE_API_VERSION` is documented in `stripe.provider.ts` but the provider
  currently pins its default in code; if you need a different pinned version,
  that is a code change, not an env flip.
- The webhook controller and signature verification are unchanged by the
  cutover — the same code path serves stub (HMAC) and live (SDK constructEvent),
  selected by the bound provider.
