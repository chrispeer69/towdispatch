/**
 * User invite payloads and DTOs.
 *
 * The invite flow replaces the legacy admin-set-password path on
 * POST /users for production onboarding:
 *
 *   1. OWNER/ADMIN POSTs /users/invite {email, role, fullName?, yardIds?}
 *      → row in user_invites; the token is emailed, not returned.
 *   2. Recipient clicks the email link, lands on /accept-invite, submits
 *      {token, password, fullName} to POST /users/accept-invite.
 *   3. API creates the user, marks the invite consumed, issues cookies.
 *
 * Token expiry: 7 days from creation. Resending an invite extends the
 * window and rotates the token (the old one becomes unusable).
 */
import { z } from 'zod';
import { ROLE_VALUES } from '../constants/roles';
import { emailSchema, passwordSchema } from './user';

export const inviteStatusValues = ['pending', 'expired', 'consumed'] as const;
export type InviteStatus = (typeof inviteStatusValues)[number];

/**
 * Payload sent by the OWNER/ADMIN to create a new invite. yardIds is
 * accepted (and stored) but currently only relevant for yard-scoped
 * roles; the UI gates the field accordingly. fullName is optional —
 * the accept page lets the recipient edit it.
 */
export const createInviteSchema = z
  .object({
    email: emailSchema,
    role: z.enum(ROLE_VALUES),
    fullName: z.string().min(1).max(120).optional(),
    yardIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict();

export type CreateInvitePayload = z.infer<typeof createInviteSchema>;

/**
 * Public payload submitted by the recipient at /accept-invite. The
 * tokenSchema is intentionally permissive (any 16+ char string) so a
 * future bump from UUIDv4 to a longer random ID doesn't break clients.
 */
export const acceptInviteSchema = z
  .object({
    token: z.string().min(16).max(256),
    password: passwordSchema,
    fullName: z.string().min(1).max(120),
  })
  .strict();

export type AcceptInvitePayload = z.infer<typeof acceptInviteSchema>;

/**
 * The shape returned by GET /users/invites. The token itself is never
 * returned — only the consumed/expired status. Inviter name is
 * resolved from the joined users row at SELECT time.
 */
export const userInviteSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: emailSchema,
  role: z.enum(ROLE_VALUES),
  yardIds: z.array(z.string().uuid()).nullable(),
  fullName: z.string().nullable(),
  invitedBy: z.string().uuid(),
  inviterName: z.string().nullable(),
  status: z.enum(inviteStatusValues),
  expiresAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type UserInviteDto = z.infer<typeof userInviteSchema>;

/**
 * Public-facing slice of an invite returned by the accept-invite landing
 * page before the recipient submits their password. The full DTO would
 * over-expose internals (tenantId is fine, invitedBy uuid is not).
 */
export const publicInvitePreviewSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLE_VALUES),
  fullName: z.string().nullable(),
  tenantName: z.string(),
  inviterName: z.string().nullable(),
  status: z.enum(inviteStatusValues),
  expiresAt: z.string().datetime(),
});

export type PublicInvitePreview = z.infer<typeof publicInvitePreviewSchema>;
