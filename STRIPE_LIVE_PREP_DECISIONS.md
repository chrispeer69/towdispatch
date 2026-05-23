# Stripe Live Cutover Prep — Decision Log

Branch: `feature/stripe-live-cutover-prep`
Goal: make the stub→live Stripe cutover a single env-flag flip, without
modifying existing payment flow logic.

---

## Pre-flight finding (reframed the task)

The task brief reads green-field ("build LiveStripePaymentService, a webhook
controller, provider factory…"), but the repo **already ships all of that**:

- `StripePaymentProvider` (`stripe.provider.ts`) — full real Stripe SDK: payment
  intents, refunds, Connect onboarding, customers/setup intents, and webhook
  signature verification. This IS the "live service" the task asks for.
- `PaymentsWebhookController` — `POST /webhooks/stripe` with raw-body HMAC/SDK
  signature verification and idempotent event ingest.
- A provider factory in `payments.module.ts`.
- A stub-driven integration suite (`test/integration/payments.spec.ts`).

**Decision:** do NOT build a duplicate `LiveStripePaymentService`. Reusing the
existing `StripePaymentProvider` honors CLAUDE.md Rule 9 (mirror, don't
duplicate) and the task's own constraint "do not modify existing payment flow
logic." The genuine gap is the explicit cutover switch + a safe boot guard.

---

## Decisions

1. **Explicit `PAYMENTS_PROVIDER` (`stub` | `live`) flag, default `stub`.**
   Previously provider selection was *implicit* — it keyed off whether
   `STRIPE_SECRET_KEY` happened to be present. That's unsafe for a deliberate
   cutover: setting a key for any reason would silently route real cards.
   An explicit flag makes go-live an intentional, single, reversible action.

2. **Removed the silent stub fallback in live mode (behavior change).**
   The old factory caught Stripe init errors and fell back to the stub with a
   `warn` log. In `live` mode this is now a hard boot failure. Rationale: a
   silent fallback in production accepts "payments" that never reach Stripe —
   money never moves, with no signal. Fail loud on boot instead.
   **Impact:** any dev/staging environment that previously relied on "keys
   present ⇒ real Stripe" must now set `PAYMENTS_PROVIDER=live` explicitly.
   `stub` remains the default, so dev/CI/tests are unaffected.

3. **Placeholder webhook-secret guard.** In `live` mode, boot is refused if
   `STRIPE_WEBHOOK_SECRET` is missing, lacks the `whsec_` prefix, or contains a
   placeholder marker (`session11`, `default`, `placeholder`, `changeme`,
   `example`). Chosen explicit markers over a blanket `includes('test')` so a
   legitimately random live secret that happens to contain "test" is not falsely
   rejected. Catches shipping with the Session 11 dev default.

4. **`sk_test_` allowed in `live` mode.** So the cutover can be rehearsed on
   staging / Stripe test mode before `sk_live_`. Boot logs `livemode:false` in
   that case. Only the missing/placeholder cases block boot.

5. **Selection logic extracted to `selectPaymentProvider()` + exported
   `isPlaceholderWebhookSecret()`.** Lets the boot guard be unit-tested without
   a Nest container or database.

6. **Tests.**
   - `payments-provider-selection.spec.ts` (unit, no DB/keys): stub default,
     live happy path, and all three fail-fast branches.
   - `payments-live.spec.ts` (integration, `describe.skip` unless
     `STRIPE_TEST_SECRET_KEY` is set): real SDK webhook verify (good + tampered)
     and Connect account creation. Destination charge + refund is further gated
     behind `STRIPE_TEST_CONNECTED_ACCOUNT` because a fresh test account can't
     accept charges until onboarded — avoids CI flake.
   - Did not duplicate the existing stub contract tests.

7. **Did NOT touch:** `StubPaymentProvider`, `PaymentsService`,
   `payments-webhook.controller.ts`, the existing `payments.spec.ts`, or any
   payment flow logic. Only the provider *selection* and config changed.

8. **`STRIPE_API_VERSION`** is documented in `stripe.provider.ts` but not read
   from env today; wiring it would be a provider code change (out of scope for a
   no-flow-change cutover). Noted in the runbook instead.

---

## Artifacts

- Runbook: `apps/api/src/modules/payments/STRIPE_LIVE_CUTOVER.md`
- Config: `PAYMENTS_PROVIDER` in `apps/api/src/config/config.schema.ts`,
  `ConfigService.payments` getter.
- Factory + guard: `apps/api/src/modules/payments/payments.module.ts`.
