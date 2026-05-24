/**
 * Customer Self-Serve Portal — session + magic-link contracts (Session 55).
 *
 * Sessions are scoped to a SINGLE impound + a verified identity, never to an
 * account (SESSION_55_DECISIONS.md D5). The magic link is exchanged once for a
 * signed, HttpOnly session cookie with a 60-minute sliding lifetime.
 */
import { z } from 'zod';

/** Exchange a magic-link token for a session cookie. */
export const portalMagicLinkVerifySchema = z
  .object({
    token: z.string().min(16).max(512),
  })
  .strict();
export type PortalMagicLinkVerifyPayload = z.infer<typeof portalMagicLinkVerifySchema>;

/** The vehicle/case view the authenticated session is scoped to. */
export const portalSessionViewSchema = z.object({
  sessionId: z.string().uuid(),
  impoundId: z.string().uuid(),
  caseNumber: z.string(),
  vehicleYear: z.number().int().nullable(),
  vehicleMake: z.string().nullable(),
  vehicleModel: z.string().nullable(),
  vehicleColor: z.string().nullable(),
  licensePlate: z.string().nullable(),
  licenseState: z.string().nullable(),
  status: z.string(),
  yardName: z.string().nullable(),
  idOnFile: z.boolean(),
  expiresAt: z.string().datetime(),
});
export type PortalSessionView = z.infer<typeof portalSessionViewSchema>;
