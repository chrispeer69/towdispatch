/**
 * SCIM bearer-token contracts (Session 38). The plaintext token is shown
 * exactly once — in the mint response — and never again. The list/DTO shape
 * carries only the non-secret prefix.
 */
import { z } from 'zod';

export const scimTokenSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  connectionId: z.string().uuid().nullable(),
  name: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ScimTokenDto = z.infer<typeof scimTokenSchema>;

export const mintScimTokenSchema = z.object({
  name: z.string().min(1).max(160),
  connectionId: z.string().uuid().optional(),
  /** Days until expiry; omit for a non-expiring token. */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  scopes: z.array(z.string().min(1).max(64)).max(32).optional(),
});
export type MintScimTokenPayload = z.infer<typeof mintScimTokenSchema>;

/** Mint response — `token` is the plaintext, returned once. */
export const mintScimTokenResponseSchema = z.object({
  token: z.string(),
  record: scimTokenSchema,
});
export type MintScimTokenResponse = z.infer<typeof mintScimTokenResponseSchema>;
