/**
 * Fraud Detection (Session 43) — composite read DTOs for the web surface.
 *
 * jobRiskSummary is the read-only job context the fraud UI shows alongside a
 * score (it never mutates the job). jobRiskDetail bundles the score + its
 * signals + that context for the risk-detail screen; highRiskListItem is the
 * flattened row for the risk queue.
 */
import { z } from 'zod';
import { disputeRecordSchema } from './disputes';
import { fraudRiskScoreSchema } from './scores';
import { fraudRiskSignalSchema } from './signals';

export const jobRiskSummarySchema = z.object({
  jobId: z.string().uuid(),
  jobNumber: z.string(),
  serviceType: z.string(),
  status: z.string(),
  motorClubName: z.string().nullable(),
  customerName: z.string().nullable(),
  vehicleVin: z.string().nullable(),
  invoiceTotalCents: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});
export type JobRiskSummaryDto = z.infer<typeof jobRiskSummarySchema>;

export const jobRiskDetailSchema = z.object({
  job: jobRiskSummarySchema,
  score: fraudRiskScoreSchema.nullable(),
  signals: z.array(fraudRiskSignalSchema),
  disputes: z.array(disputeRecordSchema),
});
export type JobRiskDetailDto = z.infer<typeof jobRiskDetailSchema>;

export const highRiskListItemSchema = z.object({
  score: fraudRiskScoreSchema,
  job: jobRiskSummarySchema,
});
export type HighRiskListItemDto = z.infer<typeof highRiskListItemSchema>;
