/**
 * Customer Self-Serve Portal — ID verification contracts (Session 55).
 *
 * V1 is SELF-ATTESTED only: the portal stores name/DOB/ID-type/ID-last4 and
 * flags "id-on-file". It NEVER releases a vehicle on self-attestation alone —
 * the gate operator must physically re-verify (SESSION_55_DECISIONS.md D6).
 * Only the last 4 of the ID are stored, encrypted at rest; never the full
 * number, never an SSN. Stripe Identity is the documented v2 path.
 */
import { z } from 'zod';

export const portalIdTypeValues = ['drivers_license', 'passport', 'state_id'] as const;
export type PortalIdType = (typeof portalIdTypeValues)[number];

export const portalVerifiedByValues = [
  'self_attested',
  'stripe_identity',
  'operator_at_gate',
] as const;
export type PortalVerifiedBy = (typeof portalVerifiedByValues)[number];

/** Self-attestation form. `idLast4` is exactly 4 digits — we reject anything longer. */
export const portalIdAttestSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be YYYY-MM-DD'),
    idType: z.enum(portalIdTypeValues),
    idLast4: z.string().regex(/^\d{4}$/, 'idLast4 must be exactly 4 digits'),
  })
  .strict();
export type PortalIdAttestPayload = z.infer<typeof portalIdAttestSchema>;

export const portalIdVerificationDtoSchema = z.object({
  id: z.string().uuid(),
  idType: z.enum(portalIdTypeValues),
  idLast4: z.string(),
  fullName: z.string(),
  verifiedBy: z.enum(portalVerifiedByValues),
  verifiedAt: z.string().datetime().nullable(),
});
export type PortalIdVerificationDto = z.infer<typeof portalIdVerificationDtoSchema>;
