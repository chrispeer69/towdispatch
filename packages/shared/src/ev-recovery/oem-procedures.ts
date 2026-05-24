/**
 * EV Recovery (Session 48) — OEM tow-procedure contracts.
 *
 * Mirrors the ev_oem_procedures reference table. tow_mode_steps /
 * hv_disconnect_steps are best-effort summaries of public OEM guidance and
 * carry lastVerifiedAt; the UI shows a "verify against the OEM service
 * manual" disclaimer. Documents/links are English (OEM source language) with
 * bilingual safety labelling supplied by the UI.
 */
import { z } from 'zod';

export const evOemProcedureSchema = z.object({
  id: z.string().uuid(),
  make: z.string(),
  model: z.string().nullable(),
  modelYearFrom: z.number().int().nullable(),
  modelYearTo: z.number().int().nullable(),
  towModeSteps: z.string(),
  hvDisconnectSteps: z.string(),
  jackingPointsUrl: z.string().nullable(),
  officialDocUrl: z.string().nullable(),
  lastVerifiedAt: z.string().datetime(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EvOemProcedureDto = z.infer<typeof evOemProcedureSchema>;

// GET /ev-recovery/oem-procedures?make=&model=&year= — resolves the most
// specific procedure for a vehicle (model match beats make-wide fallback;
// year must fall inside [from, to] when both are present).
export const oemProcedureLookupSchema = z
  .object({
    make: z.string().min(1).max(80),
    model: z.string().max(80).optional(),
    year: z.coerce.number().int().min(1990).max(2100).optional(),
  })
  .strict();
export type OemProcedureLookupQuery = z.infer<typeof oemProcedureLookupSchema>;
