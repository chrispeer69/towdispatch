/**
 * Public Marketplace API (Session 46) — developer account contracts.
 *
 * A developer account is GLOBAL (not tenant-scoped): a person/company that
 * builds apps on top of US Tow Dispatch. Auth is its own realm (audience
 * `…-developer`), fully separate from operator and driver tokens. Email
 * verification is required before an account can publish apps.
 */
import { z } from 'zod';

export const developerStatusValues = ['active', 'suspended'] as const;
export type DeveloperStatus = (typeof developerStatusValues)[number];

/** Public-safe view of a developer account (no hashes, no secrets). */
export const developerAccountSchema = z.object({
  id: z.string().uuid(),
  ownerUserEmail: z.string().email(),
  companyName: z.string(),
  verified: z.boolean(),
  status: z.enum(developerStatusValues),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DeveloperAccountDto = z.infer<typeof developerAccountSchema>;

export const developerSignupSchema = z.object({
  ownerUserEmail: z.string().email().max(320),
  companyName: z.string().min(1).max(200),
  password: z.string().min(12).max(200),
});
export type DeveloperSignupPayload = z.infer<typeof developerSignupSchema>;

/**
 * Signup intentionally returns no token and no account body — registration is
 * acknowledged (202) and the developer must verify their email before login.
 * `devVerificationToken` is populated ONLY when the email provider is the
 * console/stub (no real inbox); never in production.
 */
export const developerSignupResultSchema = z.object({
  status: z.literal('verification_required'),
  devVerificationToken: z.string().nullable(),
});
export type DeveloperSignupResult = z.infer<typeof developerSignupResultSchema>;

export const developerVerifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type DeveloperVerifyEmailPayload = z.infer<typeof developerVerifyEmailSchema>;

export const developerLoginSchema = z.object({
  ownerUserEmail: z.string().email(),
  password: z.string().min(1).max(200),
});
export type DeveloperLoginPayload = z.infer<typeof developerLoginSchema>;

export const developerSessionSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  developer: developerAccountSchema,
});
export type DeveloperSession = z.infer<typeof developerSessionSchema>;
