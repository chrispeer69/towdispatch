/**
 * Session-2-local Zod payloads.
 *
 * The Session-1 schemas in packages/shared/src/schemas/tier-offer*.ts
 * cover the operator-facing create/update shapes and the DTO read
 * surface. Two contracts were intentionally deferred to Session 2:
 *
 *   - cancelTierOfferSchema       — body for POST /tier-offers/:id/cancel
 *   - markResponseSchema          — body for the operator-side manual
 *                                   phone-call response endpoint
 *   - publicAcceptTierOfferSchema — body for POST /public/tier-offers/:token/accept
 *   - publicDeclineTierOfferSchema — body for POST /public/tier-offers/:token/decline
 *
 * We keep them inside the module rather than promoting to packages/shared
 * to honor the Session-2 constraint ("don't touch files outside the
 * tier-offers module unless wiring or env"). The web client only consumes
 * the operator surface; the public surface is fetched by the magic-link
 * landing page, which can import these types from the API module's
 * published d.ts in a later session, or duplicate the minimal shape.
 */
import { z } from 'zod';

export const cancelTierOfferSchema = z
  .object({
    reason: z.string().min(1).max(4000),
  })
  .strict();
export type CancelTierOfferPayload = z.infer<typeof cancelTierOfferSchema>;

export const markRecipientResponseSchema = z
  .object({
    decision: z.enum(['accepted', 'declined']),
    declineReason: z.string().max(4000).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.decision === 'accepted'
        ? data.declineReason === undefined || data.declineReason === ''
        : true,
    {
      message: 'declineReason is only valid when decision is "declined"',
      path: ['declineReason'],
    },
  );
export type MarkRecipientResponsePayload = z.infer<typeof markRecipientResponseSchema>;

export const publicAcceptTierOfferSchema = z
  .object({
    confirmName: z.string().min(1).max(200),
  })
  .strict();
export type PublicAcceptTierOfferPayload = z.infer<typeof publicAcceptTierOfferSchema>;

export const publicDeclineTierOfferSchema = z
  .object({
    reason: z.string().min(1).max(4000),
  })
  .strict();
export type PublicDeclineTierOfferPayload = z.infer<typeof publicDeclineTierOfferSchema>;

/**
 * Operator-side compose payload. Mirrors createTierOfferSchema from
 * packages/shared but adds the recipient roster in one shot. Session 1's
 * createTierOfferSchema covers the offer fields; we layer a roster
 * extension here so the admin "compose + send" surface is a single
 * round-trip without breaking the shared contract.
 */
export const composeAndSendInlineRecipientSchema = z
  .object({
    accountId: z.string().uuid().optional(),
    recipientName: z.string().min(1).max(200),
    recipientRole: z.string().max(200).optional(),
    recipientEmail: z.string().email().max(254),
    recipientPhone: z.string().max(40).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();
export type ComposeAndSendInlineRecipient = z.infer<typeof composeAndSendInlineRecipientSchema>;

/**
 * Public-facing view of an offer (what the magic-link landing page renders).
 * Intentionally narrow — never expose internal IDs, tenant_id, or audit
 * fields to the public surface.
 */
export interface PublicTierOfferView {
  offer: {
    title: string;
    subjectLine: string;
    narrative: string;
    eventWindowStart: string;
    eventWindowEnd: string;
    committedTruckCount: number;
    acceptanceDeadlineAt: string;
    defaultForNonResponders: 'opt_out' | 'accept_at_standard_rate';
    status: 'draft' | 'sent' | 'event_active' | 'event_concluded' | 'cancelled';
  };
  recipient: {
    recipientName: string;
    recipientEmail: string;
    status:
      | 'pending_send'
      | 'sent'
      | 'delivered'
      | 'bounced'
      | 'opened'
      | 'accepted'
      | 'declined'
      | 'expired'
      | 'revoked';
    magicLinkExpiresAt: string;
    respondedAt: string | null;
  };
  tenantName: string;
}

/** Result of a public accept/decline call. */
export interface PublicTierOfferResponseResult {
  status: 'accepted' | 'declined';
  respondedAt: string;
}
