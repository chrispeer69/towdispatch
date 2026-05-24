/**
 * Yard Management (Session 54) — release-workflow contracts.
 *
 * The 4-step gated wizard: id_verified → lienholder_authorized →
 * payment_collected → gate_released (cancel from any non-terminal state).
 * The state machine is enforced in ReleaseWorkflowService; payload schemas
 * carry only the per-step fields. Mirrors release-workflows.ts.
 */
import { z } from 'zod';

export const releaseWorkflowStatusValues = [
  'initiated',
  'id_verified',
  'lienholder_authorized',
  'payment_collected',
  'gate_released',
  'cancelled',
] as const;
export type ReleaseWorkflowStatus = (typeof releaseWorkflowStatusValues)[number];

export const releaseWorkflowPayerIdTypeValues = [
  'drivers_license',
  'state_id',
  'passport',
  'military_id',
  'other',
] as const;
export type ReleaseWorkflowPayerIdType = (typeof releaseWorkflowPayerIdTypeValues)[number];

export const releaseWorkflowPaymentMethodValues = [
  'cash',
  'card',
  'check',
  'ach',
  'waived',
  'other',
] as const;
export type ReleaseWorkflowPaymentMethod = (typeof releaseWorkflowPaymentMethodValues)[number];

export const releaseWorkflowSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  impoundId: z.string().uuid(),
  status: z.enum(releaseWorkflowStatusValues),
  initiatedAt: z.string().datetime(),
  initiatedByUserId: z.string().uuid().nullable(),
  completedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancelReason: z.string().nullable(),
  payerName: z.string().nullable(),
  payerIdType: z.enum(releaseWorkflowPayerIdTypeValues).nullable(),
  payerIdLast4: z.string().nullable(),
  lienholderAuthRef: z.string().nullable(),
  paymentAmountCents: z.number().int().nullable(),
  paymentMethod: z.enum(releaseWorkflowPaymentMethodValues).nullable(),
  gateReleasedByUserId: z.string().uuid().nullable(),
  gateReleasedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReleaseWorkflowDto = z.infer<typeof releaseWorkflowSchema>;

export const initiateReleaseSchema = z
  .object({
    impoundId: z.string().uuid(),
  })
  .strict();
export type InitiateReleasePayload = z.infer<typeof initiateReleaseSchema>;

export const verifyReleaseIdSchema = z
  .object({
    payerName: z.string().trim().min(1).max(200),
    payerIdType: z.enum(releaseWorkflowPayerIdTypeValues),
    payerIdLast4: z.string().regex(/^[0-9A-Za-z]{1,4}$/, 'last 4 chars only'),
  })
  .strict();
export type VerifyReleaseIdPayload = z.infer<typeof verifyReleaseIdSchema>;

export const authorizeLienholderSchema = z
  .object({
    lienholderAuthRef: z.string().trim().min(1).max(200),
  })
  .strict();
export type AuthorizeLienholderPayload = z.infer<typeof authorizeLienholderSchema>;

export const collectReleasePaymentSchema = z
  .object({
    paymentAmountCents: z.number().int().min(0).max(100_000_000),
    paymentMethod: z.enum(releaseWorkflowPaymentMethodValues),
  })
  .strict();
export type CollectReleasePaymentPayload = z.infer<typeof collectReleasePaymentSchema>;

export const cancelReleaseSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export type CancelReleasePayload = z.infer<typeof cancelReleaseSchema>;

/** Pure state-machine guard result (shared so web can preview the gate). */
export interface ReleaseTransitionCheck {
  allowed: boolean;
  reason: string | null;
}
