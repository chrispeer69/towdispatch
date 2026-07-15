/**
 * PaymentsModule — Session 11 Stripe payments.
 *
 * Wires:
 *   - PaymentsService (Connect onboarding, intents, refunds, webhook ingest)
 *   - PaymentsController (authenticated dispatcher / settings endpoints)
 *   - PaymentsPublicController (the /pay/[token] customer page backend)
 *   - PaymentsWebhookController (POST /webhooks/stripe)
 *
 * Provider selection (cutover):
 *   The PAYMENT_PROVIDER token is bound by a factory that reads the explicit
 *   PAYMENTS_PROVIDER flag — the single switch operators flip for go-live.
 *     - `stub` (default): in-memory provider; Stripe keys are ignored. Safe
 *       for dev, CI, and tests.
 *     - `live`: the real Stripe SDK. The factory REFUSES TO BOOT if any key is
 *       missing/invalid or the webhook secret is still a dev placeholder. There
 *       is no silent fallback to the stub in live mode — a fallback would mean
 *       real customer cards are never charged with no signal, so we fail loud.
 *   Tests can override the binding by importing PaymentsModule and
 *   `.overrideProvider(PAYMENT_PROVIDER).useValue(...)`.
 *
 * Imports BillingModule so InvoicesService is available for re-totaling
 * invoices after Stripe events.
 *
 * See STRIPE_LIVE_CUTOVER.md for the operator runbook.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import { BillingModule } from '../billing/billing.module.js';
import { PaymentsPublicController } from './payments-public.controller.js';
import { PaymentsWebhookController } from './payments-webhook.controller.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PAYMENT_PROVIDER } from './payments.tokens.js';
import type { PaymentProvider } from './provider.js';
import { StripePaymentProvider } from './stripe.provider.js';
import { StubPaymentProvider } from './stub.provider.js';

/**
 * Substrings that mark a webhook secret as a non-production placeholder. The
 * Session 11 dev default (`whsec_test_session11_default_dev_secret`) contains
 * `session11`/`default`; real Stripe `whsec_` values won't. Kept as explicit
 * markers rather than a blanket `includes('test')` so a legitimately random
 * live secret that happens to contain "test" is not falsely rejected.
 */
const PLACEHOLDER_WEBHOOK_MARKERS = ['session11', 'default', 'placeholder', 'changeme', 'example'];

export function isPlaceholderWebhookSecret(secret: string): boolean {
  if (!secret.startsWith('whsec_')) return true;
  const lower = secret.toLowerCase();
  return PLACEHOLDER_WEBHOOK_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Resolve the PaymentProvider from config. Exported so the boot-time guard can
 * be unit-tested without standing up the Nest container or a database.
 *
 * @throws Error when PAYMENTS_PROVIDER=live but Stripe is not fully configured.
 */
export function selectPaymentProvider(config: ConfigService): PaymentProvider {
  if (config.payments.provider === 'live') {
    const s = config.stripe;
    if (!s.configured) {
      throw new Error(
        'PAYMENTS_PROVIDER=live but Stripe keys are missing or invalid. Set real ' +
          'STRIPE_SECRET_KEY and STRIPE_PUBLIC_KEY before cutover. Refusing to boot ' +
          'rather than silently fall back to the stub and drop real charges.',
      );
    }
    if (isPlaceholderWebhookSecret(s.webhookSecret)) {
      throw new Error(
        'PAYMENTS_PROVIDER=live but STRIPE_WEBHOOK_SECRET is missing or still a dev ' +
          'placeholder. Set the whsec_ value from the Stripe dashboard webhook ' +
          'endpoint. Refusing to boot.',
      );
    }
    // Constructor validates the secret key and configures the SDK (no network
    // call); a placeholder key throws here and propagates — boot fails loud.
    const live = new StripePaymentProvider(s.secretKey);
    config.logger.info(
      { provider: 'live', livemode: s.secretKey.startsWith('sk_live_') },
      'PaymentsModule: using StripePaymentProvider (LIVE)',
    );
    return live;
  }
  // A production deploy quietly running the stub means every "payment" is
  // fake with no operator signal. Refuse to boot unless the deploy opts in
  // explicitly (pre-launch / card payments not yet enabled).
  if (config.nodeEnv === 'production' && !config.payments.allowStubInProduction) {
    throw new Error(
      'PAYMENTS_PROVIDER=stub in production. Either cut over to Stripe ' +
        '(PAYMENTS_PROVIDER=live with real keys — see STRIPE_LIVE_CUTOVER.md) or set ' +
        'PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true to explicitly acknowledge fake payments.',
    );
  }
  config.logger.info({ provider: 'stub' }, 'PaymentsModule: using StubPaymentProvider');
  return new StubPaymentProvider();
}

@Module({
  imports: [BillingModule],
  controllers: [PaymentsController, PaymentsPublicController, PaymentsWebhookController],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: ConfigService): PaymentProvider => selectPaymentProvider(config),
      inject: [ConfigService],
    },
    PaymentsService,
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
