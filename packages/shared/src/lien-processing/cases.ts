/**
 * Lien Processing (Session 23) — lien case contracts.
 *
 * Mirrors the lien_cases Drizzle schema. Timestamps cross the wire as
 * ISO-8601 strings; cents are integers. Status / step transitions and the
 * ready-for-sale gate are enforced in the service + the pure rule engine;
 * payloads omit machine fields (current_step, next_action_due_at, …) so
 * clients cannot bypass the workflow.
 */
import { z } from 'zod';
import { lienStateValues, lienValueTierValues } from './state-rules';

// ----------------------------------------------------------------------
// Enums (mirror the DB CHECK constraints)
// ----------------------------------------------------------------------

export const lienCaseStatusValues = [
  'open',
  'ready_for_sale',
  'sold',
  'closed',
  'canceled',
] as const;
export type LienCaseStatus = (typeof lienCaseStatusValues)[number];

export const lienCaseStepValues = [
  'opened',
  'dmv_lookup_requested',
  'dmv_lookup_complete',
  'owner_notice_sent',
  'lienholder_notice_sent',
  'publication_complete',
  'waiting_period',
  'ready_for_sale',
  'sold',
  'closed',
] as const;
export type LienCaseStep = (typeof lienCaseStepValues)[number];

export const lienCloseDispositionValues = ['sold', 'closed', 'canceled'] as const;
export type LienCloseDisposition = (typeof lienCloseDispositionValues)[number];

// ----------------------------------------------------------------------
// Rule-engine next-action contract
// ----------------------------------------------------------------------

export const lienActionValues = [
  'request_dmv_lookup',
  'complete_dmv_lookup',
  'send_owner_notice',
  'send_lienholder_notice',
  'publish_notice',
  'await_waiting_period',
  'mark_ready_for_sale',
  'conduct_sale',
  'resolve_claim',
  'none',
] as const;
export type LienActionType = (typeof lienActionValues)[number];

export const lienNextActionSchema = z.object({
  action: z.enum(lienActionValues),
  dueAt: z.string().datetime().nullable(),
  // True while the case cannot legally proceed to sale (a prerequisite is
  // outstanding or a claim was received). False only once ready_for_sale /
  // sold / closed.
  blocking: z.boolean(),
  reasons: z.array(z.string()),
});
export type LienNextAction = z.infer<typeof lienNextActionSchema>;

// ----------------------------------------------------------------------
// DTOs
// ----------------------------------------------------------------------

export const lienCaseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  impoundRecordId: z.string().uuid(),
  state: z.string(),
  status: z.enum(lienCaseStatusValues),
  currentStep: z.enum(lienCaseStepValues),
  vehicleValueTier: z.enum(lienValueTierValues),
  ownerFound: z.boolean(),
  lienholderFound: z.boolean(),
  estimatedValueCents: z.number().int().nullable(),
  openedAt: z.string().datetime(),
  nextActionDueAt: z.string().datetime().nullable(),
  readyForSaleAt: z.string().datetime().nullable(),
  soldAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  closedReason: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type LienCaseDto = z.infer<typeof lienCaseSchema>;

// ----------------------------------------------------------------------
// Payloads
// ----------------------------------------------------------------------

export const openLienCaseSchema = z
  .object({
    impoundRecordId: z.string().uuid(),
    state: z.enum(lienStateValues),
    vehicleValueTier: z.enum(lienValueTierValues).optional(),
    estimatedValueCents: z.number().int().min(0).max(1_000_000_000).optional(),
    ownerFound: z.boolean().optional(),
    lienholderFound: z.boolean().optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type OpenLienCasePayload = z.infer<typeof openLienCaseSchema>;

// advanceCase optionally carries the DMV lookup result (owner / lienholder
// found, estimated value) so the dmv_lookup_requested → dmv_lookup_complete
// transition can record it. When omitted, advanceCase moves the case to the
// next step the rule engine says is reachable without new external input.
export const advanceLienCaseSchema = z
  .object({
    ownerFound: z.boolean().optional(),
    lienholderFound: z.boolean().optional(),
    estimatedValueCents: z.number().int().min(0).max(1_000_000_000).optional(),
    vehicleValueTier: z.enum(lienValueTierValues).optional(),
  })
  .strict();
export type AdvanceLienCasePayload = z.infer<typeof advanceLienCaseSchema>;

export const updateLienCaseSchema = z
  .object({
    vehicleValueTier: z.enum(lienValueTierValues).optional(),
    estimatedValueCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    ownerFound: z.boolean().optional(),
    lienholderFound: z.boolean().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();
export type UpdateLienCasePayload = z.infer<typeof updateLienCaseSchema>;

export const closeLienCaseSchema = z
  .object({
    disposition: z.enum(lienCloseDispositionValues),
    reason: z.string().max(5000).optional(),
    salePriceCents: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .strict();
export type CloseLienCasePayload = z.infer<typeof closeLienCaseSchema>;

export const listLienCasesFilterSchema = z
  .object({
    state: z.enum(lienStateValues).optional(),
    status: z.enum(lienCaseStatusValues).optional(),
    step: z.enum(lienCaseStepValues).optional(),
    // 'true' restricts to open cases whose next_action_due_at is now-or-past.
    dueSoon: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListLienCasesFilter = z.infer<typeof listLienCasesFilterSchema>;
