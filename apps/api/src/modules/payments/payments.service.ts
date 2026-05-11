/**
 * PaymentsService — Session 11 Stripe orchestration on top of Session 10's
 * billing schema.
 *
 * Responsibilities:
 *   - Stripe Connect onboarding: create the connected account, generate the
 *     hosted onboarding link, refresh and persist account.charges_enabled /
 *     payouts_enabled / status into the tenants row.
 *   - Issuing payment intents for an invoice (online + card-on-file path).
 *   - Public /pay/[token] resolution (uses admin pool to look up the tenant
 *     from the opaque token, then runs the rest under tenant scope).
 *   - Card-on-file lifecycle: setup intents, attach saved methods, list,
 *     remove, auto-charge toggle.
 *   - Refunds.
 *   - Webhook event handling: idempotent ingestion via stripe_events PK,
 *     payment_intent.succeeded → insert payments row + recompute invoice,
 *     payment_intent.payment_failed → mark intent failed,
 *     charge.refunded → record offsetting payment row,
 *     account.updated → sync tenant's connected-account state.
 *
 * The service relies on InvoicesService.recomputeTotals() / assembleWithDetails()
 * to keep Session 10's invariants (paid_cents/balance_cents derivation and
 * status flips) intact.
 */
import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { customers, invoices, payments, tenants, uuidv7 } from '@towcommand/db';
import {
  type CardOnFileDto,
  ERROR_CODES,
  type PayLinkDto,
  type PaymentIntentDto,
  type PublicPaymentView,
  type RefundPaymentPayload,
  type StripeAccountStatus,
  type StripeConnectStatusDto,
} from '@towcommand/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Logger } from 'pino';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { PAYMENT_PROVIDER } from './payments.tokens.js';
import type { PaymentProvider, WebhookEvent } from './provider.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  role: string | null;
}

interface ResolvedToken {
  tenantId: string;
  invoiceId: string;
}

const PAYMENT_TOKEN_BYTES = 24;

const generatePaymentToken = (): string => randomBytes(PAYMENT_TOKEN_BYTES).toString('base64url');

@Injectable()
export class PaymentsService {
  private readonly logger: Logger;

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly invoicesService: InvoicesService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Optional() private readonly accounting: AccountingService | null = null,
  ) {
    this.logger = config.logger.child({ component: 'payments' });
  }

  private notifyAccountingPayment(tenantId: string, paymentId: string): void {
    if (!this.accounting) return;
    this.accounting.enqueuePaymentSync(tenantId, paymentId).catch(() => {});
  }

  private notifyAccountingRefund(tenantId: string, paymentId: string): void {
    if (!this.accounting) return;
    this.accounting.enqueueRefundSync(tenantId, paymentId).catch(() => {});
  }

  // =====================================================================
  // Stripe Connect
  // =====================================================================

  async getConnectStatus(ctx: CallerContext): Promise<StripeConnectStatusDto> {
    const tenant = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) =>
      tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) }),
    );
    if (!tenant) throw notFound('Tenant not found');
    return {
      accountId: tenant.stripeAccountId,
      accountStatus: tenant.stripeAccountStatus as StripeAccountStatus,
      chargesEnabled: tenant.stripeChargesEnabled,
      payoutsEnabled: tenant.stripePayoutsEnabled,
      platformMarginBps: tenant.platformMarginBps,
      publicKeyConfigured: !!this.config.stripe.publicKey,
    };
  }

  async startConnectOnboarding(
    ctx: CallerContext,
  ): Promise<{ accountId: string; onboardingUrl: string }> {
    requireOwnerOrAdmin(ctx.role);
    const tenant = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) =>
      tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) }),
    );
    if (!tenant) throw notFound('Tenant not found');

    let accountId = tenant.stripeAccountId;
    if (!accountId) {
      const created = await this.provider.createConnectedAccount({
        tenantId: tenant.id,
        tenantName: tenant.name,
        email: this.deriveOnboardingEmail(tenant),
      });
      accountId = created.accountId;
      await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
        await tx
          .update(tenants)
          .set({
            stripeAccountId: accountId,
            stripeAccountStatus: 'pending',
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, ctx.tenantId));
      });
    }
    const link = await this.buildOnboardingLink(accountId);
    return { accountId, onboardingUrl: link };
  }

  async refreshConnectOnboardingLink(ctx: CallerContext): Promise<{ onboardingUrl: string }> {
    requireOwnerOrAdmin(ctx.role);
    const tenant = await this.requireTenant(ctx);
    if (!tenant.stripeAccountId) {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: 'Stripe Connect onboarding not started',
      });
    }
    const url = await this.buildOnboardingLink(tenant.stripeAccountId);
    return { onboardingUrl: url };
  }

  /**
   * Re-fetch the connected account from Stripe and sync its capability flags
   * onto the tenant row. Idempotent — call after onboarding completes, or
   * via the account.updated webhook.
   */
  async syncConnectAccount(ctx: CallerContext): Promise<StripeConnectStatusDto> {
    const tenant = await this.requireTenant(ctx);
    if (!tenant.stripeAccountId) return this.getConnectStatus(ctx);
    const remote = await this.provider.getConnectedAccountStatus(tenant.stripeAccountId);
    const status = deriveAccountStatus(remote);
    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await tx
        .update(tenants)
        .set({
          stripeAccountStatus: status,
          stripeChargesEnabled: remote.chargesEnabled,
          stripePayoutsEnabled: remote.payoutsEnabled,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, ctx.tenantId));
    });
    return this.getConnectStatus(ctx);
  }

  async setPlatformMargin(ctx: CallerContext, bps: number): Promise<StripeConnectStatusDto> {
    requireOwnerOrAdmin(ctx.role);
    if (bps < 0 || bps > 1000) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'platform_margin_bps must be 0..1000',
      });
    }
    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await tx
        .update(tenants)
        .set({ platformMarginBps: bps, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId));
    });
    return this.getConnectStatus(ctx);
  }

  // =====================================================================
  // Pay link / payment intents
  // =====================================================================

  async issuePayLink(ctx: CallerContext, invoiceId: string): Promise<PayLinkDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const inv = await this.requireChargeableInvoice(tx, invoiceId);
      let token = inv.paymentToken;
      if (!token) {
        token = generatePaymentToken();
        await tx
          .update(invoices)
          .set({ paymentToken: token, updatedAt: new Date() })
          .where(eq(invoices.id, invoiceId));
      }
      const url = `${this.config.webPublicUrl}/pay/${token}`;
      return { invoiceId, token, url };
    });
  }

  async createInvoicePaymentIntent(
    ctx: CallerContext,
    payload: {
      invoiceId: string;
      chargeCardOnFile: boolean;
      savePaymentMethod: boolean;
    },
  ): Promise<PaymentIntentDto> {
    const result = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const tenant = await tx.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenantId),
      });
      if (!tenant) throw notFound('Tenant not found');
      this.requireConnectedAccount(tenant);

      const inv = await this.requireChargeableInvoice(tx, payload.invoiceId);
      const balanceCents = inv.balanceCents;

      let stripeCustomerId: string | null = null;
      let pmId: string | null = null;
      if (inv.customerId) {
        const customer = await tx.query.customers.findFirst({
          where: eq(customers.id, inv.customerId),
        });
        if (customer) {
          stripeCustomerId = await this.ensureStripeCustomerId(tx, customer, tenant);
          if (payload.chargeCardOnFile) {
            if (!customer.defaultPaymentMethodId) {
              throw new BadRequestException({
                code: ERROR_CODES.INVALID_STATE_TRANSITION,
                message: 'Customer has no card on file',
              });
            }
            pmId = customer.defaultPaymentMethodId;
          }
        }
      }

      const applicationFeeCents = Math.floor((balanceCents * tenant.platformMarginBps) / 10_000);

      const intent = await this.provider.createPaymentIntent({
        connectedAccountId: tenant.stripeAccountId as string,
        amountCents: balanceCents,
        currency: inv.currency.toLowerCase(),
        invoiceId: inv.id,
        tenantId: tenant.id,
        description: `Invoice ${inv.invoiceNumber}`,
        applicationFeeCents,
        ...(stripeCustomerId ? { customerExternalId: stripeCustomerId } : {}),
        ...(pmId ? { paymentMethodId: pmId, offSession: true } : {}),
        setupFutureUsage: payload.savePaymentMethod,
        metadata: {
          tenantId: tenant.id,
          invoiceId: inv.id,
        },
      });

      // Pre-create a payment row in 'pending' state so we have an idempotent
      // anchor for the webhook to upsert against. The unique partial index on
      // (tenant_id, stripe_payment_intent_id) WHERE not deleted prevents
      // duplicates when the dispatcher retries.
      const existing = await tx.query.payments.findFirst({
        where: and(
          eq(payments.tenantId, tenant.id),
          eq(payments.stripePaymentIntentId, intent.externalId),
          isNull(payments.deletedAt),
        ),
      });
      if (!existing) {
        await tx.insert(payments).values({
          id: uuidv7(),
          tenantId: tenant.id,
          invoiceId: inv.id,
          amountCents: intent.amountCents,
          paymentMethod: 'credit_card',
          status: intent.status === 'succeeded' ? 'cleared' : 'pending',
          stripePaymentIntentId: intent.externalId,
          stripeChargeId: intent.chargeId,
          platformMarginCents: applicationFeeCents,
          stripeFeeCents: intent.feeCents ?? 0,
          recordedBy: ctx.userId,
          notes: `Stripe PaymentIntent ${intent.externalId}`,
        });
        if (intent.status === 'succeeded') {
          await this.invoicesService.recomputeTotals(tx, tenant.id, inv.id);
        }
      }

      return {
        paymentIntentId: intent.externalId,
        clientSecret: intent.clientSecret,
        status: intent.status,
        amountCents: intent.amountCents,
        currency: intent.currency,
      } satisfies PaymentIntentDto;
    });
    return result;
  }

  // =====================================================================
  // Public pay surface (/pay/[token])
  // =====================================================================

  async resolvePayToken(token: string): Promise<ResolvedToken | null> {
    return this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.invoices.findFirst({
        where: and(eq(invoices.paymentToken, token), isNull(invoices.deletedAt)),
      });
      if (!row) return null;
      return { tenantId: row.tenantId, invoiceId: row.id };
    });
  }

  async publicView(token: string): Promise<PublicPaymentView> {
    const resolved = await this.resolvePayToken(token);
    if (!resolved) throw notFound('Unknown payment link');
    return this.db.runInTenantContext(
      {
        tenantId: resolved.tenantId,
        userId: '00000000-0000-0000-0000-000000000000',
      },
      async (tx) => {
        const inv = await tx.query.invoices.findFirst({
          where: and(eq(invoices.id, resolved.invoiceId), isNull(invoices.deletedAt)),
        });
        if (!inv) throw notFound('Invoice not found');
        if (inv.status === 'void') {
          throw new BadRequestException({
            code: ERROR_CODES.INVALID_STATE_TRANSITION,
            message: 'Invoice is void',
          });
        }
        const tenant = await tx.query.tenants.findFirst({
          where: eq(tenants.id, resolved.tenantId),
        });
        if (!tenant) throw notFound('Tenant not found');

        let intent: PaymentIntentDto | null = null;
        if (inv.balanceCents > 0 && tenant.stripeAccountId) {
          const created = await this.provider.createPaymentIntent({
            connectedAccountId: tenant.stripeAccountId,
            amountCents: inv.balanceCents,
            currency: inv.currency.toLowerCase(),
            invoiceId: inv.id,
            tenantId: tenant.id,
            description: `Invoice ${inv.invoiceNumber}`,
            applicationFeeCents: Math.floor((inv.balanceCents * tenant.platformMarginBps) / 10_000),
            metadata: { tenantId: tenant.id, invoiceId: inv.id, source: 'pay_link' },
          });
          intent = {
            paymentIntentId: created.externalId,
            clientSecret: created.clientSecret,
            status: created.status,
            amountCents: created.amountCents,
            currency: created.currency,
          };
          // Anchor row, see createInvoicePaymentIntent.
          const existing = await tx.query.payments.findFirst({
            where: and(
              eq(payments.tenantId, tenant.id),
              eq(payments.stripePaymentIntentId, created.externalId),
              isNull(payments.deletedAt),
            ),
          });
          if (!existing) {
            await tx.insert(payments).values({
              id: uuidv7(),
              tenantId: tenant.id,
              invoiceId: inv.id,
              amountCents: created.amountCents,
              paymentMethod: 'credit_card',
              status: 'pending',
              stripePaymentIntentId: created.externalId,
              platformMarginCents: Math.floor(
                (inv.balanceCents * tenant.platformMarginBps) / 10_000,
              ),
              notes: `Stripe PaymentIntent ${created.externalId} (public pay)`,
            });
          }
        }

        return {
          invoice: {
            invoiceNumber: inv.invoiceNumber,
            issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
            dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
            status: inv.status,
            totalCents: inv.totalCents,
            paidCents: inv.paidCents,
            balanceCents: inv.balanceCents,
            currency: inv.currency,
          },
          tenant: {
            name: tenant.name,
            publicKey: this.config.stripe.publicKey || null,
            stripeAccountId: tenant.stripeAccountId,
          },
          paymentIntent: intent,
        };
      },
    );
  }

  // =====================================================================
  // Card on file
  // =====================================================================

  async getCardOnFile(ctx: CallerContext, customerId: string): Promise<CardOnFileDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const c = await tx.query.customers.findFirst({
        where: and(eq(customers.id, customerId), isNull(customers.deletedAt)),
      });
      if (!c) throw notFound('Customer not found');
      return {
        customerId: c.id,
        hasCard: !!c.defaultPaymentMethodId,
        brand: c.cardBrand,
        last4: c.cardLast4,
        expMonth: c.cardExpMonth,
        expYear: c.cardExpYear,
        autoChargeEnabled: c.autoChargeEnabled,
      };
    });
  }

  async setAutoCharge(
    ctx: CallerContext,
    customerId: string,
    enabled: boolean,
  ): Promise<CardOnFileDto> {
    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const c = await tx.query.customers.findFirst({
        where: and(eq(customers.id, customerId), isNull(customers.deletedAt)),
      });
      if (!c) throw notFound('Customer not found');
      await tx
        .update(customers)
        .set({ autoChargeEnabled: enabled, updatedAt: new Date() })
        .where(eq(customers.id, customerId));
    });
    return this.getCardOnFile(ctx, customerId);
  }

  async createCustomerSetupIntent(
    ctx: CallerContext,
    customerId: string,
  ): Promise<{ clientSecret: string; setupIntentId: string }> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const tenant = await tx.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenantId),
      });
      if (!tenant) throw notFound('Tenant not found');
      this.requireConnectedAccount(tenant);
      const customer = await tx.query.customers.findFirst({
        where: and(eq(customers.id, customerId), isNull(customers.deletedAt)),
      });
      if (!customer) throw notFound('Customer not found');
      const stripeCustomerId = await this.ensureStripeCustomerId(tx, customer, tenant);
      const si = await this.provider.createSetupIntent({
        connectedAccountId: tenant.stripeAccountId as string,
        customerExternalId: stripeCustomerId,
      });
      return { clientSecret: si.clientSecret, setupIntentId: si.externalId };
    });
  }

  async removeCardOnFile(ctx: CallerContext, customerId: string): Promise<{ removed: boolean }> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const tenant = await tx.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenantId),
      });
      if (!tenant) throw notFound('Tenant not found');
      const customer = await tx.query.customers.findFirst({
        where: and(eq(customers.id, customerId), isNull(customers.deletedAt)),
      });
      if (!customer) throw notFound('Customer not found');
      if (!customer.defaultPaymentMethodId || !tenant.stripeAccountId) {
        return { removed: false };
      }
      try {
        await this.provider.detachPaymentMethod({
          connectedAccountId: tenant.stripeAccountId,
          paymentMethodId: customer.defaultPaymentMethodId,
        });
      } catch (err) {
        this.logger.warn(
          { err: String(err), customerId },
          'detach payment method failed (continuing)',
        );
      }
      await tx
        .update(customers)
        .set({
          defaultPaymentMethodId: null,
          cardBrand: null,
          cardLast4: null,
          cardExpMonth: null,
          cardExpYear: null,
          autoChargeEnabled: false,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId));
      return { removed: true };
    });
  }

  // =====================================================================
  // Refunds
  // =====================================================================

  async refundPayment(
    ctx: CallerContext,
    paymentId: string,
    payload: RefundPaymentPayload,
  ): Promise<{ ok: true; refundedCents: number; refundId: string }> {
    requireOwnerOrAdmin(ctx.role);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const tenant = await tx.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenantId),
      });
      if (!tenant) throw notFound('Tenant not found');
      const original = await tx.query.payments.findFirst({
        where: and(eq(payments.id, paymentId), isNull(payments.deletedAt)),
      });
      if (!original) throw notFound('Payment not found');
      if (!original.stripePaymentIntentId) {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'Only Stripe payments can be refunded through this endpoint',
        });
      }
      if (!tenant.stripeAccountId) {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'Stripe Connect not configured',
        });
      }
      const remaining = original.amountCents;
      const requested = payload.amountCents ?? remaining;
      if (requested <= 0 || requested > remaining) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'invalid refund amount',
        });
      }
      const refund = await this.provider.refund({
        paymentIntentId: original.stripePaymentIntentId,
        connectedAccountId: tenant.stripeAccountId,
        amountCents: requested,
        ...(payload.reason ? { reason: payload.reason } : {}),
      });

      // Insert a negative payment row representing the refund. Uses the
      // unique partial index on (tenant_id, stripe_refund_id) to keep the
      // operation idempotent if the user double-clicks.
      const exists = await tx.query.payments.findFirst({
        where: and(
          eq(payments.tenantId, tenant.id),
          eq(payments.stripeRefundId, refund.externalId),
          isNull(payments.deletedAt),
        ),
      });
      if (!exists) {
        await tx.insert(payments).values({
          id: uuidv7(),
          tenantId: tenant.id,
          invoiceId: original.invoiceId,
          amountCents: -refund.amountCents,
          paymentMethod: 'credit_card',
          status: 'cleared',
          // Refund rows carry only stripe_refund_id — the unique partial index
          // on (tenant_id, stripe_payment_intent_id) forbids two non-deleted
          // rows sharing a PI, so we link refunds via charge_id instead.
          stripeRefundId: refund.externalId,
          stripeChargeId: original.stripeChargeId,
          recordedBy: ctx.userId,
          notes: `Refund of ${original.id} (PI ${original.stripePaymentIntentId ?? '-'})`,
        });
      }
      await this.invoicesService.recomputeTotals(tx, tenant.id, original.invoiceId);
      // Also enqueue a refund-sync. The refund row id is what we know; the
      // sync handler looks it up + emits a RefundReceipt to QBO.
      const refundRow = await tx.query.payments.findFirst({
        where: and(
          eq(payments.tenantId, tenant.id),
          eq(payments.stripeRefundId, refund.externalId),
          isNull(payments.deletedAt),
        ),
      });
      if (refundRow) this.notifyAccountingRefund(tenant.id, refundRow.id);
      return { ok: true as const, refundedCents: refund.amountCents, refundId: refund.externalId };
    });
  }

  // =====================================================================
  // Webhook processing
  // =====================================================================

  /**
   * Verify the Stripe-Signature header against the raw request body and
   * return the parsed event. Throws BadRequestException on signature failure.
   */
  parseWebhookEvent(rawBody: string, signature: string): WebhookEvent {
    const secret = this.config.stripe.webhookSecret;
    try {
      return this.provider.verifyWebhookSignature(rawBody, signature, secret);
    } catch (err) {
      throw new BadRequestException({
        code: 'invalid_signature',
        message: `Stripe signature verification failed: ${(err as Error).message}`,
      });
    }
  }

  /**
   * Idempotent ingestion of a webhook event. Returns:
   *   { handled: true, duplicate: false }  — first time we saw it, processed.
   *   { handled: true, duplicate: true  }  — we already processed this event id.
   *   { handled: false }                   — event type not relevant to us.
   */
  async handleWebhookEvent(event: WebhookEvent): Promise<{
    handled: boolean;
    duplicate: boolean;
  }> {
    // Step 1: insert into stripe_events keyed on Stripe's event id. If the
    // row already existed (Stripe re-delivered the event), the INSERT becomes
    // a no-op and we short-circuit.
    const firstSeen = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<{ id: string }>(
        `INSERT INTO stripe_events (id, type, livemode, payload, received_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [event.id, event.type, event.livemode, JSON.stringify(event.payload ?? event)],
      );
      return r.rowCount === 1;
    });
    if (!firstSeen) return { handled: true, duplicate: true };

    // Step 2: route by type.
    let handled = true;
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.onPaymentIntentSucceeded(event);
          break;
        case 'payment_intent.payment_failed':
          await this.onPaymentIntentFailed(event);
          break;
        case 'charge.refunded':
          await this.onChargeRefunded(event);
          break;
        case 'charge.dispute.created':
          await this.onDisputeCreated(event);
          break;
        case 'account.updated':
          await this.onAccountUpdated(event);
          break;
        default:
          handled = false;
          break;
      }
      await this.markEventProcessed(event.id, null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.markEventProcessed(event.id, message);
      throw err;
    }
    return { handled, duplicate: false };
  }

  private async onPaymentIntentSucceeded(event: WebhookEvent): Promise<void> {
    const obj = event.data.object as {
      id: string;
      amount: number;
      latest_charge?: string | { id: string; balance_transaction?: { fee?: number } | string };
      payment_method?: string | { id: string };
      metadata?: Record<string, string>;
    };
    const piId = obj.id;
    const tenantId = obj.metadata?.tenantId;
    const invoiceId = obj.metadata?.invoiceId;
    if (!tenantId || !invoiceId) {
      this.logger.warn({ piId }, 'payment_intent.succeeded without tenant/invoice metadata');
      return;
    }
    const chargeId =
      typeof obj.latest_charge === 'string' ? obj.latest_charge : (obj.latest_charge?.id ?? null);
    let feeCents = 0;
    if (typeof obj.latest_charge === 'object' && obj.latest_charge?.balance_transaction) {
      const bt = obj.latest_charge.balance_transaction;
      if (typeof bt === 'object' && 'fee' in bt) feeCents = bt.fee ?? 0;
    }
    const pmId =
      typeof obj.payment_method === 'string'
        ? obj.payment_method
        : (obj.payment_method?.id ?? null);

    await this.db.runInTenantContext(
      { tenantId, userId: '00000000-0000-0000-0000-000000000000' },
      async (tx) => {
        const existing = await tx.query.payments.findFirst({
          where: and(
            eq(payments.tenantId, tenantId),
            eq(payments.stripePaymentIntentId, piId),
            isNull(payments.deletedAt),
          ),
        });
        if (existing) {
          await tx
            .update(payments)
            .set({
              amountCents: obj.amount,
              status: 'cleared',
              stripeChargeId: chargeId,
              stripeFeeCents: feeCents,
              updatedAt: new Date(),
            })
            .where(eq(payments.id, existing.id));
        } else {
          await tx.insert(payments).values({
            id: uuidv7(),
            tenantId,
            invoiceId,
            amountCents: obj.amount,
            paymentMethod: 'credit_card',
            status: 'cleared',
            stripePaymentIntentId: piId,
            stripeChargeId: chargeId,
            stripeFeeCents: feeCents,
            notes: `Stripe PaymentIntent ${piId}`,
          });
        }

        // Save card-on-file when a payment_method id is present and the
        // payment intent had setup_future_usage. The PI object exposes that
        // via the `setup_future_usage` field on the parent (not the latest
        // charge), but we don't have it here — so we save whenever pm is
        // present and the customer has a stripe_customer_id link.
        if (pmId) {
          await this.persistCardOnFileFromIntent(tx, tenantId, invoiceId, pmId);
        }

        await this.invoicesService.recomputeTotals(tx, tenantId, invoiceId);

        // Session 12: enqueue accounting sync for the now-cleared payment.
        const synced = await tx.query.payments.findFirst({
          where: and(
            eq(payments.tenantId, tenantId),
            eq(payments.stripePaymentIntentId, piId),
            isNull(payments.deletedAt),
          ),
        });
        if (synced) this.notifyAccountingPayment(tenantId, synced.id);
      },
    );
  }

  private async onPaymentIntentFailed(event: WebhookEvent): Promise<void> {
    const obj = event.data.object as {
      id: string;
      metadata?: Record<string, string>;
    };
    const tenantId = obj.metadata?.tenantId;
    if (!tenantId) return;
    await this.db.runInTenantContext(
      { tenantId, userId: '00000000-0000-0000-0000-000000000000' },
      async (tx) => {
        await tx
          .update(payments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(
            and(
              eq(payments.tenantId, tenantId),
              eq(payments.stripePaymentIntentId, obj.id),
              isNull(payments.deletedAt),
            ),
          );
      },
    );
  }

  private async onChargeRefunded(event: WebhookEvent): Promise<void> {
    const obj = event.data.object as {
      id: string;
      payment_intent?: string;
      amount_refunded?: number;
      metadata?: Record<string, string>;
    };
    const piId = obj.payment_intent;
    if (!piId) return;
    await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<{ tenant_id: string; invoice_id: string; amount_cents: number }>(
        `SELECT tenant_id, invoice_id, amount_cents FROM payments
         WHERE stripe_payment_intent_id = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`,
        [piId],
      );
      const row = r.rows[0];
      if (!row) return;
      const refunded = obj.amount_refunded ?? row.amount_cents;
      // Idempotency: refund row keyed by stripe_refund_id (unique partial index).
      await client.query(
        `INSERT INTO payments (id, tenant_id, invoice_id, amount_cents, payment_method,
                              status, stripe_charge_id, stripe_refund_id, notes)
         VALUES ($1, $2::uuid, $3::uuid, $4, 'credit_card', 'cleared', $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [
          uuidv7(),
          row.tenant_id,
          row.invoice_id,
          -Math.abs(refunded),
          obj.id,
          `${obj.id}_webhook`,
          `Refund via webhook for ${piId}`,
        ],
      );
    });
    const tenantId = obj.metadata?.tenantId ?? (await this.lookupTenantForPi(piId));
    if (!tenantId) return;
    await this.db.runInTenantContext(
      { tenantId, userId: '00000000-0000-0000-0000-000000000000' },
      async (tx) => {
        const original = await tx.query.payments.findFirst({
          where: and(eq(payments.stripePaymentIntentId, piId), isNull(payments.deletedAt)),
        });
        if (original) {
          await this.invoicesService.recomputeTotals(tx, tenantId, original.invoiceId);
        }
      },
    );
  }

  private async onDisputeCreated(event: WebhookEvent): Promise<void> {
    const obj = event.data.object as { id: string; charge?: string };
    this.logger.warn({ disputeId: obj.id, chargeId: obj.charge }, 'Stripe dispute opened');
    // Phase 1: just log. Phase 2: notify ops, mark invoice disputed.
  }

  private async onAccountUpdated(event: WebhookEvent): Promise<void> {
    const obj = event.data.object as {
      id: string;
      charges_enabled?: boolean;
      payouts_enabled?: boolean;
      details_submitted?: boolean;
      requirements?: { currently_due?: string[] };
    };
    const status = deriveAccountStatus({
      chargesEnabled: !!obj.charges_enabled,
      payoutsEnabled: !!obj.payouts_enabled,
      detailsSubmitted: !!obj.details_submitted,
      requirementsCurrentlyDue: obj.requirements?.currently_due ?? [],
    });
    await this.admin.runAsAdmin({}, async (_db, client) => {
      await client.query(
        `UPDATE tenants
         SET stripe_account_status = $1,
             stripe_charges_enabled = $2,
             stripe_payouts_enabled = $3,
             updated_at = now()
         WHERE stripe_account_id = $4`,
        [status, !!obj.charges_enabled, !!obj.payouts_enabled, obj.id],
      );
    });
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private async requireTenant(ctx: CallerContext): Promise<typeof tenants.$inferSelect> {
    const t = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) =>
      tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) }),
    );
    if (!t) throw notFound('Tenant not found');
    return t;
  }

  private async requireChargeableInvoice(
    tx: Tx,
    invoiceId: string,
  ): Promise<typeof invoices.$inferSelect> {
    const inv = await tx.query.invoices.findFirst({
      where: and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)),
    });
    if (!inv) throw notFound('Invoice not found');
    if (inv.status === 'draft') {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: 'Issue the invoice before requesting payment',
      });
    }
    if (inv.status === 'void') {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: 'Invoice is void',
      });
    }
    if (inv.balanceCents <= 0) {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: 'Invoice has no outstanding balance',
      });
    }
    return inv;
  }

  private requireConnectedAccount(t: typeof tenants.$inferSelect): void {
    if (!t.stripeAccountId) {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: 'Stripe Connect onboarding not started',
      });
    }
    // We allow charges_enabled=false here: the account may be onboarded but
    // restricted; let Stripe surface the friendly "we still need X" error
    // rather than gating up front.
  }

  private async ensureStripeCustomerId(
    tx: Tx,
    customer: typeof customers.$inferSelect,
    tenant: typeof tenants.$inferSelect,
  ): Promise<string> {
    if (customer.stripeCustomerId) return customer.stripeCustomerId;
    if (!tenant.stripeAccountId) {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: 'Stripe Connect not configured',
      });
    }
    const created = await this.provider.createCustomer({
      tenantId: tenant.id,
      connectedAccountId: tenant.stripeAccountId,
      name: customer.name,
      email: customer.email ?? undefined,
      phone: customer.phone ?? undefined,
      metadata: { customerId: customer.id },
    });
    await tx
      .update(customers)
      .set({ stripeCustomerId: created.externalId, updatedAt: new Date() })
      .where(eq(customers.id, customer.id));
    return created.externalId;
  }

  private deriveOnboardingEmail(t: typeof tenants.$inferSelect): string {
    const settings = (t.settings as Record<string, unknown>) ?? {};
    const billingEmail =
      (settings.billing_email as string | undefined) ??
      (settings.billingEmail as string | undefined);
    return billingEmail ?? `connect-${t.slug}@example.invalid`;
  }

  private async buildOnboardingLink(accountId: string): Promise<string> {
    const link = await this.provider.createOnboardingLink({
      accountId,
      refreshUrl: `${this.config.webPublicUrl}/settings/payments?refresh=1`,
      returnUrl: `${this.config.webPublicUrl}/settings/payments?return=1`,
    });
    return link.url;
  }

  private async persistCardOnFileFromIntent(
    tx: Tx,
    tenantId: string,
    invoiceId: string,
    paymentMethodId: string,
  ): Promise<void> {
    const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });
    if (!inv?.customerId) return;
    const customer = await tx.query.customers.findFirst({
      where: and(eq(customers.id, inv.customerId), eq(customers.tenantId, tenantId)),
    });
    if (!customer) return;
    // We only have the pm id here (no last4/brand without an extra retrieve).
    // Capture the id; brand/last4 are populated by a downstream sync if/when
    // the dashboard fetches them. Future card-on-file UI can call retrieve().
    await tx
      .update(customers)
      .set({ defaultPaymentMethodId: paymentMethodId, updatedAt: new Date() })
      .where(eq(customers.id, customer.id));
  }

  private async lookupTenantForPi(piId: string): Promise<string | null> {
    return this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM payments WHERE stripe_payment_intent_id = $1 LIMIT 1',
        [piId],
      );
      return r.rows[0]?.tenant_id ?? null;
    });
  }

  private async markEventProcessed(eventId: string, error: string | null): Promise<void> {
    await this.admin.runAsAdmin({}, async (_db, client) => {
      await client.query(
        'UPDATE stripe_events SET processed_at = now(), processing_error = $2 WHERE id = $1',
        [eventId, error],
      );
    });
  }
}

// =====================================================================
// Helpers
// =====================================================================

function toTenantCtx(ctx: CallerContext): {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress ?? undefined,
    userAgent: ctx.userAgent ?? undefined,
  };
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message });
}

function requireOwnerOrAdmin(role: string | null): void {
  if (role !== 'owner' && role !== 'admin') {
    throw new ForbiddenException({
      code: ERROR_CODES.FORBIDDEN,
      message: 'owner/admin only',
    });
  }
}

function deriveAccountStatus(s: {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
}): StripeAccountStatus {
  if (!s.detailsSubmitted) return 'pending';
  if (s.chargesEnabled && s.payoutsEnabled) return 'active';
  if (s.requirementsCurrentlyDue.length > 0) return 'restricted';
  return 'restricted';
}
