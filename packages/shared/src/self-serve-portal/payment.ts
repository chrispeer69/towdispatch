/**
 * Customer Self-Serve Portal — payment contracts (Session 55).
 *
 * Card data NEVER touches our servers: the API creates a Stripe PaymentIntent
 * (Connect, on the tenant's connected account) and returns a client secret;
 * the browser renders Stripe Elements against it (PCI SAQ A). The webhook then
 * flips the release intent to ready_for_gate. Partial payments are disallowed
 * in v1 (SESSION_55_DECISIONS.md D8). See the payments module for the rail.
 */
import { z } from 'zod';

export const portalPaymentStatusValues = ['pending', 'succeeded', 'failed', 'refunded'] as const;
export type PortalPaymentStatus = (typeof portalPaymentStatusValues)[number];

/** Begin payment for the session's release intent (no body — amount is the snapshot total). */
export const portalPayRequestSchema = z.object({}).strict();
export type PortalPayRequest = z.infer<typeof portalPayRequestSchema>;

/** Returned to the browser so Stripe Elements can confirm the PaymentIntent. */
export const portalPayInitResultSchema = z.object({
  releaseIntentId: z.string().uuid(),
  amountCents: z.number().int(),
  currency: z.string(),
  clientSecret: z.string().nullable(),
  publishableKey: z.string().nullable(),
  stripeAccountId: z.string().nullable(),
});
export type PortalPayInitResult = z.infer<typeof portalPayInitResultSchema>;

export const portalPaymentDtoSchema = z.object({
  id: z.string().uuid(),
  releaseIntentId: z.string().uuid().nullable(),
  stripePaymentIntentId: z.string(),
  amountCents: z.number().int(),
  status: z.enum(portalPaymentStatusValues),
  paidAt: z.string().datetime().nullable(),
});
export type PortalPaymentDto = z.infer<typeof portalPaymentDtoSchema>;
