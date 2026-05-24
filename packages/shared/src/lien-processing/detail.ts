/**
 * Lien Processing (Session 23) — case detail aggregate.
 *
 * What GET /lien-cases/:id returns: the case, its notices + timeline, the
 * rule engine's computed next action, and a snapshot summary of the linked
 * impound record (read-only — the impound module owns that data).
 */
import { z } from 'zod';
import { lienCaseSchema, lienNextActionSchema } from './cases';
import { lienNoticeSchema } from './notices';
import { lienTimelineEventSchema } from './timeline';

// Read-only snapshot of the linked impound record for display on the case.
export const lienImpoundSummarySchema = z.object({
  impoundRecordId: z.string().uuid(),
  vehicleDescription: z.string(),
  licensePlate: z.string().nullable(),
  licenseState: z.string().nullable(),
  vehicleVin: z.string().nullable(),
  yardName: z.string().nullable(),
  arrivedAt: z.string().datetime(),
  daysStored: z.number().int(),
  accruedFeeCents: z.number().int(),
});
export type LienImpoundSummary = z.infer<typeof lienImpoundSummarySchema>;

export const lienCaseDetailSchema = z.object({
  case: lienCaseSchema,
  impound: lienImpoundSummarySchema,
  notices: z.array(lienNoticeSchema),
  timeline: z.array(lienTimelineEventSchema),
  nextAction: lienNextActionSchema,
});
export type LienCaseDetailDto = z.infer<typeof lienCaseDetailSchema>;
