/**
 * Yard Management (Session 54) — gate-search contracts.
 *
 * A single lookup across impound records by plate / VIN / case number /
 * payer-or-owner last name, returning the vehicle, its current stall,
 * release status, and the balance owed (the operator's gate-booth view).
 */
import { z } from 'zod';

export const gateSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
});
export type GateSearchQuery = z.infer<typeof gateSearchQuerySchema>;

export const gateSearchMatchSchema = z.object({
  impoundId: z.string().uuid(),
  vehicleDescription: z.string(),
  licensePlate: z.string().nullable(),
  licenseState: z.string().nullable(),
  vehicleVin: z.string().nullable(),
  status: z.string(),
  facilityId: z.string().uuid().nullable(),
  facilityName: z.string().nullable(),
  stallId: z.string().uuid().nullable(),
  stallLabel: z.string().nullable(),
  releaseStatus: z.string().nullable(),
  balanceOwedCents: z.number().int(),
});
export type GateSearchMatch = z.infer<typeof gateSearchMatchSchema>;

export const gateSearchResultSchema = z.object({
  query: z.string(),
  matches: z.array(gateSearchMatchSchema),
});
export type GateSearchResult = z.infer<typeof gateSearchResultSchema>;
