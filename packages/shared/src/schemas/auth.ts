/**
 * Auth contract schemas. These run on both client (react-hook-form via the
 * Zod resolver) and server (NestJS ZodBody) so the rules are kept in sync.
 *
 * Password rules are intentionally enforced server-side through passwordSchema
 * (see ./user). The signupSchema mirrors the flat shape used by the API:
 * { tenantName, tenantSlug, ownerName, ownerEmail, password }.
 *
 * The prior nested signupSchema (tenant: {...}, user: {...}) is preserved as
 * `signupNestedSchema` for backward compatibility with the original auth
 * controller; new code should use the flat signupSchema.
 */
import { z } from 'zod';
import { tenantSlugSchema } from './tenant';
import { emailSchema, passwordSchema } from './user';

// ---------- signup (flat — Session 2.0 contract) ----------
export const signupSchema = z.object({
  tenantName: z.string().min(1).max(120),
  tenantSlug: tenantSlugSchema,
  ownerName: z.string().min(1).max(240),
  ownerEmail: emailSchema,
  password: passwordSchema,
});
export type SignupPayload = z.infer<typeof signupSchema>;

// ---------- login ----------
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  tenantSlug: tenantSlugSchema.optional(),
});
export type LoginPayload = z.infer<typeof loginSchema>;

export const tenantSelectionSchema = z.object({
  slug: tenantSlugSchema,
  name: z.string(),
});
export type TenantSelectionDto = z.infer<typeof tenantSelectionSchema>;

// ---------- refresh / logout ----------
export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshPayload = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type LogoutPayload = z.infer<typeof logoutSchema>;

// ---------- email verification ----------
export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(512),
});
export type VerifyEmailPayload = z.infer<typeof verifyEmailSchema>;

// ---------- password reset ----------
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordPayload = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: passwordSchema,
});
export type ResetPasswordPayload = z.infer<typeof resetPasswordSchema>;

// ---------- MFA ----------
export const mfaVerifySetupSchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, '6-digit code required'),
});
export type MfaVerifySetupPayload = z.infer<typeof mfaVerifySetupSchema>;

export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
});
export type MfaDisablePayload = z.infer<typeof mfaDisableSchema>;

export const mfaLoginSchema = z.object({
  mfaToken: z.string().min(1).max(512),
  totpCode: z.string().regex(/^\d{6}$/, '6-digit code required'),
});
export type MfaLoginPayload = z.infer<typeof mfaLoginSchema>;

export const mfaSetupResponseSchema = z.object({
  otpAuthUrl: z.string().min(1),
  secret: z.string().min(1),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

// ---------- token / response shapes ----------
export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const accessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  tid: z.string().uuid(),
  role: z.string(),
  jti: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  iss: z.string(),
  aud: z.string(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

export const authUserDtoSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  firstName: z.string(),
  lastName: z.string(),
  role: z.string(),
  emailVerifiedAt: z.string().datetime().nullable(),
  mfaEnabled: z.boolean(),
});
export type AuthUserDto = z.infer<typeof authUserDtoSchema>;

export const authTenantDtoSchema = z.object({
  id: z.string().uuid(),
  slug: tenantSlugSchema,
  name: z.string(),
  status: z.string(),
});
export type AuthTenantDto = z.infer<typeof authTenantDtoSchema>;

/**
 * Login / signup response. Discriminated by `status`:
 *   - 'authenticated': tokens are present, user is signed in.
 *   - 'needs_tenant_selection': multiple tenants matched the email; client
 *     must re-submit /auth/login with a tenantSlug.
 *   - 'mfa_required': user has MFA enabled; client must call /auth/mfa/login.
 */
export const authenticatedResponseSchema = z.object({
  status: z.literal('authenticated'),
  user: authUserDtoSchema,
  tenant: authTenantDtoSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AuthenticatedResponse = z.infer<typeof authenticatedResponseSchema>;

export const tenantSelectionResponseSchema = z.object({
  status: z.literal('needs_tenant_selection'),
  tenants: z.array(tenantSelectionSchema),
});
export type TenantSelectionResponse = z.infer<typeof tenantSelectionResponseSchema>;

export const mfaRequiredResponseSchema = z.object({
  status: z.literal('mfa_required'),
  mfaToken: z.string(),
});
export type MfaRequiredResponse = z.infer<typeof mfaRequiredResponseSchema>;

export const loginResponseSchema = z.discriminatedUnion('status', [
  authenticatedResponseSchema,
  tenantSelectionResponseSchema,
  mfaRequiredResponseSchema,
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const meResponseSchema = z.object({
  user: authUserDtoSchema,
  tenant: authTenantDtoSchema,
  permissions: z.array(z.string()),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
