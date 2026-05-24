/**
 * Fraud Detection (Session 43) — dispute-outcome (ground-truth) contracts.
 *
 * Once a dispute resolves, the operator records whether it was actually fraud
 * and optionally which signal predicted it. Feeds a future model-training
 * pipeline (deferred). signalId is optional.
 */
import { z } from 'zod';

export const disputeOutcomeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  disputeId: z.string().uuid(),
  signalId: z.string().uuid().nullable(),
  wasFraud: z.boolean(),
  groundTruthAt: z.string().datetime(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type DisputeOutcomeDto = z.infer<typeof disputeOutcomeSchema>;

export const recordDisputeOutcomeSchema = z
  .object({
    wasFraud: z.boolean(),
    signalId: z.string().uuid().optional(),
    groundTruthAt: z.string().datetime().optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type RecordDisputeOutcomePayload = z.infer<typeof recordDisputeOutcomeSchema>;
