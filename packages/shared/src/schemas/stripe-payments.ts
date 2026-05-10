/**
 * Stripe payments — Session 11 wire contracts.
 *
 * These DTOs/payloads sit alongside billing.ts so the web app can consume
 * Stripe surfaces (Connect onboarding, /pay/[token], card-on-file, refunds)
 * without reaching into Stripe's own types.
 */
import { z } from 'zod';

const cents = z.number().int();
const positiveCents = z.number().int().positive();

export const stripeAccountStatusValues = [
  'none',
  'pending',
  'active',
  'restricted',
  'rejected',
] as const;
export type StripeAccountStatus = (typeof stripeAccountStatusValues)[number];

// ---------- Stripe Connect onboarding ----------

export const stripeConnectStatusDtoSchema = z.object({
  accountId: z.string().nullable(),
  accountStatus: z.enum(stripeAccountStatusValues),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  platformMarginBps: z.number().int().min(0).max(1000),
  /** Live keys configured on the platform (presence only, never the secret). */
  publicKeyConfigured: z.boolean(),
});
export type StripeConnectStatusDto = z.infer<typeof stripeConnectStatusDtoSchema>;

export const stripeConnectStartResponseSchema = z.object({
  accountId: z.string(),
  onboardingUrl: z.string().url(),
});
export type StripeConnectStartResponse = z.infer<typeof stripeConnectStartResponseSchema>;

export const stripeConnectRefreshResponseSchema = z.object({
  onboardingUrl: z.string().url(),
});
export type StripeConnectRefreshResponse = z.infer<typeof stripeConnectRefreshResponseSchema>;

export const updatePlatformMarginSchema = z.object({
  platformMarginBps: z.number().int().min(0).max(1000),
});
export type UpdatePlatformMarginPayload = z.infer<typeof updatePlatformMarginSchema>;

// ---------- payment intent / pay-link ----------

export const createInvoicePaymentIntentSchema = z.object({
  invoiceId: z.string().uuid(),
  /**
   * If true, attempt to charge the customer's saved card-on-file synchronously.
   * Otherwise, return a client_secret so a hosted /pay/[token] page can collect.
   */
  chargeCardOnFile: z.boolean().default(false),
  savePaymentMethod: z.boolean().default(false),
});
export type CreateInvoicePaymentIntentPayload = z.infer<typeof createInvoicePaymentIntentSchema>;

export const paymentIntentDtoSchema = z.object({
  paymentIntentId: z.string(),
  clientSecret: z.string().nullable(),
  status: z.enum([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'requires_capture',
    'succeeded',
    'canceled',
  ]),
  amountCents: positiveCents,
  currency: z.string(),
});
export type PaymentIntentDto = z.infer<typeof paymentIntentDtoSchema>;

export const issuePayLinkSchema = z.object({
  invoiceId: z.string().uuid(),
});
export type IssuePayLinkPayload = z.infer<typeof issuePayLinkSchema>;

export const payLinkDtoSchema = z.object({
  invoiceId: z.string().uuid(),
  token: z.string(),
  url: z.string().url(),
});
export type PayLinkDto = z.infer<typeof payLinkDtoSchema>;

// ---------- public /pay/[token] view ----------

export const publicPaymentViewSchema = z.object({
  invoice: z.object({
    invoiceNumber: z.string(),
    issuedAt: z.string().datetime().nullable(),
    dueAt: z.string().datetime().nullable(),
    status: z.string(),
    totalCents: cents,
    paidCents: cents,
    balanceCents: cents,
    currency: z.string(),
  }),
  tenant: z.object({
    name: z.string(),
    publicKey: z.string().nullable(),
    /** Stripe Connect account id used as the on-behalf-of for the PI. */
    stripeAccountId: z.string().nullable(),
  }),
  paymentIntent: paymentIntentDtoSchema.nullable(),
});
export type PublicPaymentView = z.infer<typeof publicPaymentViewSchema>;

// ---------- card on file ----------

export const cardOnFileDtoSchema = z.object({
  customerId: z.string().uuid(),
  hasCard: z.boolean(),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  expMonth: z.number().int().nullable(),
  expYear: z.number().int().nullable(),
  autoChargeEnabled: z.boolean(),
});
export type CardOnFileDto = z.infer<typeof cardOnFileDtoSchema>;

export const setAutoChargeSchema = z.object({
  enabled: z.boolean(),
});
export type SetAutoChargePayload = z.infer<typeof setAutoChargeSchema>;

export const removeCardOnFileResponseSchema = z.object({
  removed: z.boolean(),
});
export type RemoveCardOnFileResponse = z.infer<typeof removeCardOnFileResponseSchema>;

// ---------- refunds ----------

export const refundPaymentSchema = z.object({
  /** When omitted, refund the full amount of the original payment. */
  amountCents: z.number().int().positive().optional(),
  reason: z
    .enum(['duplicate', 'fraudulent', 'requested_by_customer', 'expired_uncaptured_charge'])
    .optional(),
});
export type RefundPaymentPayload = z.infer<typeof refundPaymentSchema>;

// ---------- terminal (card-present, Phase 1 stub) ----------

export const terminalConnectionTokenDtoSchema = z.object({
  secret: z.string(),
});
export type TerminalConnectionTokenDto = z.infer<typeof terminalConnectionTokenDtoSchema>;
