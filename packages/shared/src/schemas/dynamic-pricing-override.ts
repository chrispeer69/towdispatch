/**
 * Dynamic pricing override — operator manual price override on a quote.
 */
import { z } from 'zod';

export const dynamicPricingOverrideReasonValues = [
  'price_match',
  'customer_complaint',
  'manager_approved',
  'goodwill',
  'error_correction',
  'competitive_pressure',
  'other_with_note',
] as const;
export type DynamicPricingOverrideReason = (typeof dynamicPricingOverrideReasonValues)[number];

export const createDynamicPricingOverrideSchema = z
  .object({
    overridePriceCents: z.number().int().nonnegative(),
    reasonCode: z.enum(dynamicPricingOverrideReasonValues),
    note: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.reasonCode === 'other_with_note' && (!data.note || data.note.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'note is required when reasonCode is other_with_note',
      });
    }
  });
export type CreateDynamicPricingOverridePayload = z.infer<typeof createDynamicPricingOverrideSchema>;

export const dynamicPricingOverrideDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  originalPriceCents: z.number().int(),
  overridePriceCents: z.number().int(),
  tierStackSnapshot: z.array(
    z.object({
      tierId: z.string().uuid(),
      name: z.string(),
      category: z.string(),
      multiplier: z.number(),
    }),
  ),
  reasonCode: z.enum(dynamicPricingOverrideReasonValues),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type DynamicPricingOverrideDto = z.infer<typeof dynamicPricingOverrideDtoSchema>;
