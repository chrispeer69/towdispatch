/**
 * SSO login-audit contracts (Session 38). Read-only forensic trail surfaced
 * in the admin UI.
 */
import { z } from 'zod';

export const ssoLoginOutcomeValues = ['success', 'fail', 'denied'] as const;
export type SsoLoginOutcome = (typeof ssoLoginOutcomeValues)[number];

export const ssoLoginAuditSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  connectionId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  provider: z.enum(['saml', 'oidc']).nullable(),
  outcome: z.enum(ssoLoginOutcomeValues),
  failureReason: z.string().nullable(),
  subject: z.string().nullable(),
  ip: z.string().nullable(),
  occurredAt: z.string().datetime(),
});
export type SsoLoginAuditDto = z.infer<typeof ssoLoginAuditSchema>;
