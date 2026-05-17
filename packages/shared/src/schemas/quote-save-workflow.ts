/**
 * Quote save workflow — when a customer declines a quote we run a
 * structured save funnel:
 *   step 1: 5% discount
 *   step 2: extra 5% (10% total)
 *   counter: operator-typed counter price
 *   manager_call: final fallback
 */
import { z } from 'zod';

export const quoteSaveWorkflowStepValues = [
  'save_step_1',
  'save_step_2',
  'save_step_counter',
  'save_step_manager_call',
] as const;
export type QuoteSaveWorkflowStep = (typeof quoteSaveWorkflowStepValues)[number];

export const quoteDeclineReasonValues = [
  'too_expensive',
  'found_alternative',
  'no_longer_needs',
  'eta_too_long',
  'payment_issue',
  'customer_changed_mind',
  'other',
] as const;
export type QuoteDeclineReason = (typeof quoteDeclineReasonValues)[number];

export const declineQuoteSchema = z
  .object({
    declineReasonCode: z.enum(quoteDeclineReasonValues),
    note: z.string().max(2000).optional(),
  })
  .strict();
export type DeclineQuotePayload = z.infer<typeof declineQuoteSchema>;

export const saveStepResponseSchema = z
  .object({
    accepted: z.boolean(),
    customPriceCents: z.number().int().nonnegative().optional(),
    declineReasonCode: z.enum(quoteDeclineReasonValues).optional(),
  })
  .strict();
export type SaveStepResponsePayload = z.infer<typeof saveStepResponseSchema>;

export const quoteSaveWorkflowEventDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  step: z.enum(quoteSaveWorkflowStepValues),
  discountPct: z.number().nullable(),
  customPriceCents: z.number().int().nullable(),
  declineReasonCode: z.enum(quoteDeclineReasonValues).nullable(),
  accepted: z.boolean(),
  recordedByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type QuoteSaveWorkflowEventDto = z.infer<typeof quoteSaveWorkflowEventDtoSchema>;

/** Map step → discount pct (server uses these to compute the offered amount) */
export const SAVE_STEP_DISCOUNT_PCT: Record<QuoteSaveWorkflowStep, number | null> = {
  save_step_1: 5,
  save_step_2: 10,
  save_step_counter: null,
  save_step_manager_call: null,
};

/** Allowed next-step transitions. */
export const SAVE_STEP_NEXT: Record<QuoteSaveWorkflowStep, QuoteSaveWorkflowStep | null> = {
  save_step_1: 'save_step_2',
  save_step_2: 'save_step_counter',
  save_step_counter: 'save_step_manager_call',
  save_step_manager_call: null,
};
