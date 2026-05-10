/**
 * PaymentsModule — Session 11 Stripe payments.
 *
 * Wires:
 *   - PaymentsService (Connect onboarding, intents, refunds, webhook ingest)
 *   - PaymentsController (authenticated dispatcher / settings endpoints)
 *   - PaymentsPublicController (the /pay/[token] customer page backend)
 *   - PaymentsWebhookController (POST /webhooks/stripe)
 *
 * Provider selection:
 *   The PAYMENT_PROVIDER token is bound by a factory that reads
 *   ConfigService.stripe.configured. When STRIPE_SECRET_KEY is present we
 *   instantiate the real Stripe SDK; otherwise we use the in-memory stub.
 *   Tests can override the binding by importing PaymentsModule and
 *   `.overrideProvider(PAYMENT_PROVIDER).useValue(...)`.
 *
 * Imports BillingModule so InvoicesService is available for re-totaling
 * invoices after Stripe events.
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

@Module({
  imports: [BillingModule],
  controllers: [PaymentsController, PaymentsPublicController, PaymentsWebhookController],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: ConfigService): PaymentProvider => {
        const s = config.stripe;
        if (s.configured) {
          try {
            return new StripePaymentProvider(s.secretKey);
          } catch (err) {
            config.logger.warn(
              { err: String(err) },
              'StripePaymentProvider failed to initialize — falling back to stub',
            );
          }
        }
        config.logger.info(
          { stripeConfigured: s.configured },
          'PaymentsModule: using StubPaymentProvider',
        );
        return new StubPaymentProvider();
      },
      inject: [ConfigService],
    },
    PaymentsService,
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
