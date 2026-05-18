/**
 * Tier Offer Composer (Session 1) — Zod contracts for
 * tier_offer_recipients.
 *
 * Mirrors the Drizzle schema enums and column shapes from
 * packages/db/src/schema/tier-offer-recipients.ts.
 *
 * Two write surfaces are exposed:
 *   - createTierOfferRecipientSchema   — operator adds a recipient to
 *     an offer's roster (server fills in magic_link_token + expiry).
 *   - updateTierOfferRecipientSchema   — operator edits notes / state
 *     before the offer is sent, or marks a manual phone-call response.
 *
 * The recipient-facing accept/decline submission has its own narrower
 * payload (added in Session 2 with the public landing-page route).
 */
import { z } from 'zod';

export const tierOfferRecipientStatusValues = [
  'pending_send',
  'sent',
  'delivered',
  'bounced',
  'opened',
  'accepted',
  'declined',
  'expired',
  'revoked',
] as const;
export type TierOfferRecipientStatus = (typeof tierOfferRecipientStatusValues)[number];

export const tierOfferRecipientSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  offerId: z.string().uuid(),
  accountId: z.string().uuid().nullable(),
  recipientName: z.string(),
  recipientRole: z.string().nullable(),
  recipientEmail: z.string().email(),
  recipientPhone: z.string().nullable(),
  magicLinkToken: z.string(),
  magicLinkExpiresAt: z.string().datetime(),
  status: z.enum(tierOfferRecipientStatusValues),
  emailSentAt: z.string().datetime().nullable(),
  emailDeliveredAt: z.string().datetime().nullable(),
  emailOpenedAt: z.string().datetime().nullable(),
  respondedAt: z.string().datetime().nullable(),
  responseIp: z.string().nullable(),
  responseUserAgent: z.string().nullable(),
  declineReason: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type TierOfferRecipientDto = z.infer<typeof tierOfferRecipientSchema>;

/**
 * Add a recipient to an offer's roster. The server mints the
 * magic_link_token (signed JWT planned in Session 2) and computes
 * magic_link_expires_at — clients never supply either.
 */
export const createTierOfferRecipientSchema = z
  .object({
    offerId: z.string().uuid(),
    accountId: z.string().uuid().optional(),
    recipientName: z.string().min(1).max(200),
    recipientRole: z.string().max(200).optional(),
    recipientEmail: z.string().email().max(254),
    recipientPhone: z.string().max(40).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();
export type CreateTierOfferRecipientPayload = z.infer<typeof createTierOfferRecipientSchema>;

/**
 * Edits an operator may make to a recipient row pre-send (correcting a
 * mistyped email) or post-send (logging a phone-call confirmation).
 * Status transitions are applied via dedicated service actions
 * (markResponseFromManualPhoneCall, revokeRecipient, etc.) rather than
 * a direct PATCH of `status` — this update schema intentionally omits
 * status, magicLinkToken, and the timestamp fields that come from the
 * send/respond pipelines.
 */
export const updateTierOfferRecipientSchema = z
  .object({
    accountId: z.string().uuid().nullable().optional(),
    recipientName: z.string().min(1).max(200).optional(),
    recipientRole: z.string().max(200).nullable().optional(),
    recipientEmail: z.string().email().max(254).optional(),
    recipientPhone: z.string().max(40).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    declineReason: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type UpdateTierOfferRecipientPayload = z.infer<typeof updateTierOfferRecipientSchema>;
