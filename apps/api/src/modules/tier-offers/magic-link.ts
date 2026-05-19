/**
 * Tier Offer magic-link signing + verification.
 *
 * Each tier_offer_recipients row carries a magic_link_token: an HS256 JWT
 * signed with the platform-shared JWT_SECRET. The token is the bearer
 * credential the recipient uses to open the public landing page at
 * /offers/[token] and to POST accept / decline. The token IS the
 * authentication — the public routes never check a tenant header or a
 * logged-in session.
 *
 * Why HS256 and JWT_SECRET (not a new secret):
 *   - The platform already has well-tested rotation runbooks for JWT_SECRET.
 *   - Adding a new secret is more configuration to keep aligned across
 *     dev / staging / production / Railway and would create a footgun the
 *     first time someone forgets to set it.
 *   - Domain separation from access / refresh / mfa / driver tokens comes
 *     from the `aud` claim ("tier-offer-magic-link") and the bearer
 *     claims (recipientId, offerId, tenantId), so a stolen access token
 *     can never accidentally be accepted by verifyMagicLink and vice
 *     versa.
 *
 * TTL: caller-supplied per call. Production callers default to 7 days
 * from sentAt — long enough to survive a long weekend, short enough that
 * a misplaced inbox link doesn't open a claim file forever.
 *
 * This module is pure: no DB, no NestJS DI. The TierOfferService injects
 * ConfigService and passes the JWT_SECRET in.
 */

import { SignJWT, jwtVerify } from 'jose';

export interface MagicLinkPayload {
  recipientId: string;
  offerId: string;
  tenantId: string;
  /** Unix-seconds expiration. Mirrors the JWT `exp` claim — caller may inspect. */
  exp: number;
}

const ALGORITHM = 'HS256';
const AUDIENCE = 'tier-offer-magic-link';

function asKey(secret: string): Uint8Array {
  if (!secret) {
    throw new Error('JWT_SECRET is not configured; cannot sign tier-offer magic links');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Sign a tier-offer magic link. Caller controls TTL via `ttlSeconds`;
 * the canonical default for production is 7 days (604_800 seconds).
 */
export async function signMagicLink(
  payload: { recipientId: string; offerId: string; tenantId: string },
  ttlSeconds: number,
  secret: string,
): Promise<{ token: string; expiresAt: Date }> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('ttlSeconds must be a positive integer');
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + ttlSeconds;
  const token = await new SignJWT({
    recipientId: payload.recipientId,
    offerId: payload.offerId,
    tenantId: payload.tenantId,
  })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(exp)
    .setAudience(AUDIENCE)
    .sign(asKey(secret));
  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Verify a tier-offer magic link. Returns the decoded payload on
 * success or null for any failure: missing/empty input, bad signature,
 * expired, malformed (missing required fields), wrong audience.
 *
 * Callers MUST also re-check downstream invariants against the database
 * (recipient row exists, status hasn't been revoked, offer not cancelled,
 * tenant matches). Token verification only proves "this server minted this
 * token AND it has not yet expired."
 */
export async function verifyMagicLink(
  token: string | undefined | null,
  secret: string,
): Promise<MagicLinkPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, asKey(secret), {
      algorithms: [ALGORITHM],
      audience: AUDIENCE,
    });
    const recipientId = (payload as Record<string, unknown>).recipientId;
    const offerId = (payload as Record<string, unknown>).offerId;
    const tenantId = (payload as Record<string, unknown>).tenantId;
    const exp = payload.exp;
    if (
      typeof recipientId !== 'string' ||
      typeof offerId !== 'string' ||
      typeof tenantId !== 'string' ||
      typeof exp !== 'number'
    ) {
      return null;
    }
    return { recipientId, offerId, tenantId, exp };
  } catch {
    return null;
  }
}
