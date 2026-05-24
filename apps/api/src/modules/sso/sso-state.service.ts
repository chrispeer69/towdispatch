/**
 * Signed login-state for SSO CSRF protection.
 *
 * At /login we mint a short-lived (10m) HS256 JWT carrying the connection id,
 * a random nonce, and (for OIDC) the PKCE code_verifier, and drop it in an
 * httpOnly + Secure + SameSite=Lax cookie. At the IdP callback we read the
 * cookie, verify it, and bind it to what the IdP returned (SAML RelayState ===
 * nonce; OIDC state === nonce, and the id_token nonce === nonce). Without the
 * matching cookie a forged callback fails closed.
 *
 * The signing key is domain-separated from the operator access-token key
 * (::sso-state suffix) so a leaked state cannot be replayed as an access token.
 */
import { Injectable } from '@nestjs/common';
import { type JWTPayload, SignJWT, jwtVerify } from 'jose';
import { ConfigService } from '../../config/config.service.js';

export const SSO_STATE_COOKIE = 'sso_state';
const STATE_TTL = '10m';

export interface SsoStatePayload {
  /** sso_connections.id this login is for. */
  cid: string;
  /** 'saml' | 'oidc'. */
  p: 'saml' | 'oidc';
  /** Random anti-CSRF nonce; echoed as RelayState (SAML) / state (OIDC). */
  n: string;
  /** OIDC PKCE code_verifier (absent for SAML). */
  cv?: string;
}

@Injectable()
export class SsoStateService {
  private readonly key: Uint8Array;
  private readonly audience: string;

  constructor(config: ConfigService) {
    this.key = new TextEncoder().encode(`${config.jwt.accessSecret}::sso-state`);
    this.audience = `${config.jwt.audience}-sso-state`;
  }

  async sign(payload: SsoStatePayload): Promise<string> {
    return new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setAudience(this.audience)
      .setExpirationTime(STATE_TTL)
      .sign(this.key);
  }

  async verify(token: string): Promise<SsoStatePayload> {
    const { payload } = await jwtVerify(token, this.key, {
      audience: this.audience,
      algorithms: ['HS256'],
    });
    const p = payload as JWTPayload & Partial<SsoStatePayload>;
    if (
      typeof p.cid !== 'string' ||
      typeof p.n !== 'string' ||
      (p.p !== 'saml' && p.p !== 'oidc')
    ) {
      throw new Error('Invalid SSO state token');
    }
    return {
      cid: p.cid,
      p: p.p,
      n: p.n,
      ...(typeof p.cv === 'string' ? { cv: p.cv } : {}),
    };
  }
}
