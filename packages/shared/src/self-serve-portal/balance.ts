/**
 * Customer Self-Serve Portal — balance + breakdown contracts (Session 55).
 *
 * The balance is computed from the impound fee ledger (S22): tow/intake,
 * daily storage to date, and administrative/lien/gate fees. All amounts are
 * integer cents. The breakdown groups the ledger by fee type so the owner
 * sees exactly what they are paying.
 */
import { z } from 'zod';

export const portalBalanceLineSchema = z.object({
  feeType: z.string(),
  label: z.string(),
  amountCents: z.number().int(),
});
export type PortalBalanceLine = z.infer<typeof portalBalanceLineSchema>;

export const portalBalanceSchema = z.object({
  impoundId: z.string().uuid(),
  currency: z.string(),
  towChargesCents: z.number().int(),
  storageChargesCents: z.number().int(),
  administrativeFeesCents: z.number().int(),
  otherFeesCents: z.number().int(),
  totalCents: z.number().int(),
  paidCents: z.number().int(),
  balanceCents: z.number().int(),
  lines: z.array(portalBalanceLineSchema),
  asOf: z.string().datetime(),
});
export type PortalBalance = z.infer<typeof portalBalanceSchema>;
