/**
 * EV Recovery (Session 48) — charge-stop contracts.
 *
 * A drained EV may need charge to reach its destination or to wake up enough
 * to enter Transport Mode. paidBy feeds the reimbursement report. kwhDelivered
 * and costCents are numbers over the wire (cents are integers).
 */
import { z } from 'zod';

export const evChargePaidByValues = ['tenant', 'customer', 'club'] as const;
export type EvChargePaidBy = (typeof evChargePaidByValues)[number];

export const evChargeStopSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  stationNetwork: z.string().nullable(),
  stationAddress: z.string().nullable(),
  arrivedAt: z.string().datetime(),
  departedAt: z.string().datetime().nullable(),
  kwhDelivered: z.number().nullable(),
  costCents: z.number().int().nullable(),
  paidBy: z.enum(evChargePaidByValues),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type EvChargeStopDto = z.infer<typeof evChargeStopSchema>;

export const logChargeStopSchema = z
  .object({
    stationNetwork: z.string().max(120).optional(),
    stationAddress: z.string().max(500).optional(),
    arrivedAt: z.string().datetime().optional(),
    departedAt: z.string().datetime().optional(),
    kwhDelivered: z.number().min(0).max(500).optional(),
    costCents: z.number().int().min(0).max(1_000_000_000).optional(),
    paidBy: z.enum(evChargePaidByValues).optional(),
  })
  .strict();
export type LogChargeStopPayload = z.infer<typeof logChargeStopSchema>;
