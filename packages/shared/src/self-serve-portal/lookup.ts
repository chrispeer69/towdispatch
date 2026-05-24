/**
 * Customer Self-Serve Portal — vehicle lookup contracts (Session 55).
 *
 * A vehicle owner looks up their impounded vehicle WITHOUT an account. The
 * lookup never returns full vehicle details: on a multi-match it returns
 * masked previews requiring more specificity, and on a single match it sends a
 * magic link to the owner's phone/email on file and returns only a sessionId.
 * Tenant is resolved from the request Host (subdomain / custom domain), never
 * from the lookup body — see SESSION_55_DECISIONS.md D1/D10.
 */
import { z } from 'zod';

/** At least one identifier is required; the service AND-filters whatever is supplied. */
export const portalLookupSchema = z
  .object({
    plate: z.string().trim().min(1).max(16).optional(),
    vin: z.string().trim().min(4).max(17).optional(),
    caseNumber: z.string().trim().min(1).max(40).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.plate || v.vin || v.caseNumber || v.lastName), {
    message: 'Provide at least one of plate, vin, caseNumber, or lastName',
  });
export type PortalLookupPayload = z.infer<typeof portalLookupSchema>;

/** A masked preview returned on a multi-match — never enough to identify the vehicle. */
export const portalLookupMatchSchema = z.object({
  impoundId: z.string().uuid(),
  maskedCase: z.string(),
  maskedPlate: z.string().nullable(),
  maskedVin: z.string().nullable(),
});
export type PortalLookupMatch = z.infer<typeof portalLookupMatchSchema>;

/**
 * Lookup result. `found` + `sessionId` on a unique match (a magic link was
 * sent via `channel`); `partialMatches` populated when the query matched more
 * than one live impound and the owner must narrow it down. `found:false` with
 * no matches is indistinguishable to the client from a no-result (no oracle).
 */
export const portalLookupResultSchema = z.object({
  found: z.boolean(),
  sessionId: z.string().uuid().nullable(),
  channel: z.enum(['sms', 'email']).nullable(),
  partialMatches: z.array(portalLookupMatchSchema),
});
export type PortalLookupResult = z.infer<typeof portalLookupResultSchema>;
