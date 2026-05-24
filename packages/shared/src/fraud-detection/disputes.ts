/**
 * Fraud Detection (Session 43) — dispute-log contracts.
 *
 * A dispute_record is the operator's log of a motor-club dispute against a
 * job's invoice. v1 is operator-entered (no partner integration). Resolving a
 * dispute (won / lost / partial / withdrawn) records the recovered amount;
 * the dispute log derives win/loss rate + avg resolution time from these.
 */
import { z } from 'zod';

export const disputeTypeValues = ['pricing', 'service', 'fraud', 'duplicate', 'other'] as const;
export type DisputeType = (typeof disputeTypeValues)[number];

export const disputeStatusValues = ['open', 'won', 'lost', 'withdrawn', 'partial'] as const;
export type DisputeStatus = (typeof disputeStatusValues)[number];

/** Terminal statuses a dispute can be resolved into. */
export const disputeResolutionStatusValues = ['won', 'lost', 'partial', 'withdrawn'] as const;
export type DisputeResolutionStatus = (typeof disputeResolutionStatusValues)[number];

export const disputeRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  motorClubName: z.string(),
  disputeType: z.enum(disputeTypeValues),
  disputedAt: z.string().datetime(),
  amountDisputedCents: z.number().int(),
  status: z.enum(disputeStatusValues),
  resolutionAt: z.string().datetime().nullable(),
  resolutionAmountCents: z.number().int().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type DisputeRecordDto = z.infer<typeof disputeRecordSchema>;

// ----------------------------------------------------------------------
// Payloads
// ----------------------------------------------------------------------

export const recordDisputeSchema = z
  .object({
    jobId: z.string().uuid(),
    motorClubName: z.string().min(1).max(200),
    disputeType: z.enum(disputeTypeValues).optional(),
    amountDisputedCents: z.number().int().min(0).max(100_000_000).optional(),
    disputedAt: z.string().datetime().optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type RecordDisputePayload = z.infer<typeof recordDisputeSchema>;

export const resolveDisputeSchema = z
  .object({
    status: z.enum(disputeResolutionStatusValues),
    resolutionAmountCents: z.number().int().min(0).max(100_000_000).optional(),
    resolutionAt: z.string().datetime().optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type ResolveDisputePayload = z.infer<typeof resolveDisputeSchema>;

export const listDisputesFilterSchema = z
  .object({
    status: z.enum(disputeStatusValues).optional(),
    motorClubName: z.string().max(200).optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strict();
export type ListDisputesFilter = z.infer<typeof listDisputesFilterSchema>;

// ----------------------------------------------------------------------
// Reports — per-motor-club aggregate (the dispute-reports table)
// ----------------------------------------------------------------------

export const disputeClubStatSchema = z.object({
  motorClubName: z.string(),
  total: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  partial: z.number().int(),
  withdrawn: z.number().int(),
  open: z.number().int(),
  /** Win rate over resolved (won+lost+partial) disputes, 0-100, null if none. */
  winRatePct: z.number().nullable(),
  avgResolutionDays: z.number().nullable(),
  amountDisputedCents: z.number().int(),
  recoveredCents: z.number().int(),
});
export type DisputeClubStatDto = z.infer<typeof disputeClubStatSchema>;

export const disputeStatsSchema = z.object({
  generatedAt: z.string().datetime(),
  windowDays: z.number().int(),
  clubs: z.array(disputeClubStatSchema),
});
export type DisputeStatsDto = z.infer<typeof disputeStatsSchema>;
