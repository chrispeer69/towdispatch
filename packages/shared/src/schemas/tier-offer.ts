/**
 * Tier Offer Composer (Session 1) — Zod contracts for tier_offers.
 *
 * Mirrors the Drizzle schema enums and column shapes from
 * packages/db/src/schema/tier-offers.ts. Timestamps over the wire are
 * ISO-8601 strings; Drizzle hands them back as Date objects on the
 * server and we serialize at the boundary — Zod's z.string().datetime()
 * validates either direction without dragging Date into shared client
 * code.
 *
 * Per-recipient contracts live in tier-offer-recipient.ts.
 */
import { z } from 'zod';

export const tierOfferDefaultForNonRespondersValues = [
  'opt_out',
  'accept_at_standard_rate',
] as const;
export type TierOfferDefaultForNonResponders =
  (typeof tierOfferDefaultForNonRespondersValues)[number];

export const tierOfferStatusValues = [
  'draft',
  'sent',
  'event_active',
  'event_concluded',
  'cancelled',
] as const;
export type TierOfferStatus = (typeof tierOfferStatusValues)[number];

export const tierOfferSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tierId: z.string().uuid(),
  composedBy: z.string().uuid().nullable(),
  title: z.string(),
  subjectLine: z.string(),
  narrative: z.string(),
  eventWindowStart: z.string().datetime(),
  eventWindowEnd: z.string().datetime(),
  committedTruckCount: z.number().int().min(1),
  acceptanceDeadlineAt: z.string().datetime(),
  defaultForNonResponders: z.enum(tierOfferDefaultForNonRespondersValues),
  status: z.enum(tierOfferStatusValues),
  sentAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancelledReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type TierOfferDto = z.infer<typeof tierOfferSchema>;

/**
 * Operator composes a new offer. Window/deadline ordering is enforced
 * at the schema level here AND by CHECK constraints in the migration —
 * Zod surfaces friendly errors at the API boundary, the DB is the
 * absolute floor.
 */
export const createTierOfferSchema = z
  .object({
    tierId: z.string().uuid(),
    title: z.string().min(1).max(200),
    subjectLine: z.string().min(1).max(200),
    narrative: z.string().min(1).max(20_000),
    eventWindowStart: z.string().datetime(),
    eventWindowEnd: z.string().datetime(),
    committedTruckCount: z.number().int().min(1).max(10_000),
    acceptanceDeadlineAt: z.string().datetime(),
    defaultForNonResponders: z.enum(tierOfferDefaultForNonRespondersValues).default('opt_out'),
  })
  .strict()
  .refine((data) => new Date(data.eventWindowEnd) > new Date(data.eventWindowStart), {
    message: 'eventWindowEnd must be after eventWindowStart',
    path: ['eventWindowEnd'],
  })
  .refine((data) => new Date(data.acceptanceDeadlineAt) <= new Date(data.eventWindowStart), {
    message: 'acceptanceDeadlineAt must be at or before eventWindowStart',
    path: ['acceptanceDeadlineAt'],
  });
export type CreateTierOfferPayload = z.infer<typeof createTierOfferSchema>;

/**
 * Partial update of a draft / in-flight offer. Status transitions are
 * applied through dedicated service-layer actions (send, cancel,
 * conclude) rather than direct PATCH of `status` — this update schema
 * intentionally omits `status` so clients can't bypass the state
 * machine. The same holds for `sentAt` / `cancelledAt` / `cancelledReason`
 * which are set by their respective actions.
 */
export const updateTierOfferSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    subjectLine: z.string().min(1).max(200).optional(),
    narrative: z.string().min(1).max(20_000).optional(),
    eventWindowStart: z.string().datetime().optional(),
    eventWindowEnd: z.string().datetime().optional(),
    committedTruckCount: z.number().int().min(1).max(10_000).optional(),
    acceptanceDeadlineAt: z.string().datetime().optional(),
    defaultForNonResponders: z.enum(tierOfferDefaultForNonRespondersValues).optional(),
  })
  .strict();
export type UpdateTierOfferPayload = z.infer<typeof updateTierOfferSchema>;

/**
 * Operator cancels a sent offer (Session 2). Reason is optional but
 * recommended; recipients still in flight will be revoked as a side
 * effect.
 */
export const cancelTierOfferSchema = z
  .object({
    reason: z.string().max(2000).optional(),
  })
  .strict();
export type CancelTierOfferPayload = z.infer<typeof cancelTierOfferSchema>;
