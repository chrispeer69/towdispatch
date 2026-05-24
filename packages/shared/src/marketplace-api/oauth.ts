/**
 * Public Marketplace API (Session 46) — OAuth2 authorization-code-with-PKCE
 * contracts (RFC 6749 + RFC 7636).
 *
 * Flow:
 *   1. Operator (OWNER/ADMIN) approves an install: POST /oauth/authorize
 *      → short-lived single-use authorization code bound to the PKCE challenge.
 *   2. App exchanges code + verifier + client secret: POST /oauth/token
 *      → opaque access + refresh tokens (hashed at rest, revocable).
 *   3. App refreshes: POST /oauth/token (grant_type=refresh_token).
 *   4. Uninstall or POST /oauth/revoke invalidates the tokens.
 *
 * We support ONLY `S256` PKCE (no `plain`) — a public-client best practice.
 */
import { z } from 'zod';
import { MARKETPLACE_SCOPES } from './scopes';

export const pkceMethodValues = ['S256'] as const;
export type PkceMethod = (typeof pkceMethodValues)[number];

const scopeEnum = z.enum(MARKETPLACE_SCOPES);
const httpsUrl = z.string().url().startsWith('https://', 'must be an https URL');

/**
 * Body for POST /oauth/authorize (operator-authed). The operator's tenant is
 * taken from their session, never the body — an app can't target a tenant the
 * caller isn't operating. `codeChallenge` is base64url(sha256(verifier)).
 */
export const authorizeRequestSchema = z.object({
  clientId: z.string().uuid(),
  redirectUri: httpsUrl,
  scopes: z.array(scopeEnum).min(1),
  state: z.string().min(1).max(512),
  codeChallenge: z.string().min(43).max(128),
  codeChallengeMethod: z.enum(pkceMethodValues),
});
export type AuthorizeRequest = z.infer<typeof authorizeRequestSchema>;

export const authorizeResultSchema = z.object({
  code: z.string(),
  state: z.string(),
  /** redirectUri with `?code=…&state=…` appended — where the app expects the browser. */
  redirectTo: z.string().url(),
});
export type AuthorizeResult = z.infer<typeof authorizeResultSchema>;

export const grantTypeValues = ['authorization_code', 'refresh_token'] as const;
export type GrantType = (typeof grantTypeValues)[number];

/**
 * POST /oauth/token. Discriminated by `grantType`. Public endpoint: the app
 * authenticates with clientId + clientSecret (confidential-client) AND, for
 * the auth-code grant, proves possession of the PKCE verifier.
 */
export const tokenRequestSchema = z.discriminatedUnion('grantType', [
  z.object({
    grantType: z.literal('authorization_code'),
    clientId: z.string().uuid(),
    clientSecret: z.string().min(1),
    code: z.string().min(1),
    redirectUri: httpsUrl,
    codeVerifier: z.string().min(43).max(128),
  }),
  z.object({
    grantType: z.literal('refresh_token'),
    clientId: z.string().uuid(),
    clientSecret: z.string().min(1),
    refreshToken: z.string().min(1),
  }),
]);
export type TokenRequest = z.infer<typeof tokenRequestSchema>;

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  scope: z.string(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const revokeRequestSchema = z.object({
  clientId: z.string().uuid(),
  clientSecret: z.string().min(1),
  /** Either the access or refresh token; both belonging to the install are revoked. */
  token: z.string().min(1),
});
export type RevokeRequest = z.infer<typeof revokeRequestSchema>;

/** Token introspection result for the demo scope-gated `/v1/me` endpoint. */
export const tokenIdentitySchema = z.object({
  tenantId: z.string().uuid(),
  appId: z.string().uuid(),
  appSlug: z.string(),
  installId: z.string().uuid(),
  scopes: z.array(z.string()),
});
export type TokenIdentity = z.infer<typeof tokenIdentitySchema>;
