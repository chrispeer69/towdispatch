/**
 * Thin JWT wrapper around `jose`. We picked `jose` over `jsonwebtoken`:
 *   - it's standards-correct (validates issuer/audience/iat/exp by default),
 *   - has zero CVE history compared to the long jsonwebtoken track record,
 *   - supports HS256 with `Uint8Array` keys (no PEM gymnastics for shared secrets).
 *
 * Access tokens: HS256, signed with JWT_ACCESS_SECRET, short TTL (~15m).
 * Refresh tokens: a 256-bit random opaque string. We do NOT use a JWT for the
 *   refresh token — opaque tokens with a server-side argon2id hash are simpler
 *   to revoke and don't leak claims.
 * MFA challenge tokens: short-lived (5m) HS256 JWTs that sit between password
 *   verification and TOTP entry. They carry sub/tid/role and a `mfa: true`
 *   marker so they can never be exchanged for a normal access token.
 */
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type JWTPayload, SignJWT, jwtVerify } from 'jose';
import { ConfigService } from '../../config/config.service.js';

export interface MfaChallengeClaims extends JWTPayload {
  sub: string;
  tid: string;
  role: string;
  mfa?: true;
  mfa_setup?: true;
}

/**
 * Driver-app session claims. Audience suffix `-driver` keeps the driver
 * keyspace fully separate from the operator access tokens — they can't be
 * accidentally accepted by JwtAuthGuard, and vice versa.
 */
export interface DriverAccessClaims extends JWTPayload {
  sub: 'driver';
  driverId: string;
  tid: string;
}

/**
 * Customer-portal session claims (Session 32). `sub` is the portal user id,
 * `cid` the bound customer id, `tid` the tenant. Audience `-portal` and a
 * dedicated signing key keep portal customers off the operator and driver
 * surfaces entirely.
 */
export interface PortalAccessClaims extends JWTPayload {
  sub: string;
  cid: string;
 * Auction bidder session claims (Session 33). Audience suffix `-bidder`
 * keeps the bidder keyspace fully separate from operator/driver tokens.
 */
export interface BidderAccessClaims extends JWTPayload {
  sub: 'bidder';
  bidderId: string;
  tid: string;
}

@Injectable()
export class JwtService {
  private readonly accessKey: Uint8Array;
  private readonly mfaKey: Uint8Array;
  private readonly driverKey: Uint8Array;
  private readonly portalKey: Uint8Array;
  private readonly bidderKey: Uint8Array;

  constructor(private readonly config: ConfigService) {
    this.accessKey = new TextEncoder().encode(config.jwt.accessSecret);
    this.mfaKey = new TextEncoder().encode(config.jwt.mfaSecret);
    this.driverKey = new TextEncoder().encode(config.jwt.driverSecret);
    this.portalKey = new TextEncoder().encode(config.jwt.portalSecret);
    this.bidderKey = new TextEncoder().encode(config.jwt.bidderSecret);
  }

  async signAccess(claims: {
    sub: string;
    tid: string;
    role: string;
    jti: string;
  }): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.config.jwt.issuer)
      .setAudience(this.config.jwt.audience)
      .setExpirationTime(this.config.jwt.accessTtl)
      .sign(this.accessKey);
  }

  async verifyAccess(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.accessKey, {
      issuer: this.config.jwt.issuer,
      audience: this.config.jwt.audience,
      algorithms: ['HS256'],
    });
    return payload;
  }

  async signMfaChallenge(claims: { sub: string; tid: string; role: string }): Promise<string> {
    return new SignJWT({ ...claims, mfa: true })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.config.jwt.issuer)
      .setAudience(`${this.config.jwt.audience}-mfa`)
      .setExpirationTime('5m')
      .sign(this.mfaKey);
  }

  /**
   * Signs an MFA setup token returned when a privileged user (OWNER/ADMIN)
   * authenticates without having MFA enrolled. The client must complete
   * /auth/mfa/setup + /auth/mfa/verify-setup before any access tokens are
   * issued.
   */
  async signMfaSetupRequired(claims: {
    sub: string;
    tid: string;
    role: string;
  }): Promise<string> {
    return new SignJWT({ ...claims, mfa_setup: true })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.config.jwt.issuer)
      .setAudience(`${this.config.jwt.audience}-mfa-setup`)
      .setExpirationTime('15m')
      .sign(this.mfaKey);
  }

  async verifyMfaSetupRequired(token: string): Promise<MfaChallengeClaims> {
    const { payload } = await jwtVerify(token, this.mfaKey, {
      issuer: this.config.jwt.issuer,
      audience: `${this.config.jwt.audience}-mfa-setup`,
      algorithms: ['HS256'],
    });
    if (
      payload.mfa_setup !== true ||
      typeof payload.sub !== 'string' ||
      typeof payload.tid !== 'string'
    ) {
      throw new Error('Invalid MFA setup token');
    }
    return payload as MfaChallengeClaims;
  }

  async verifyMfaChallenge(token: string): Promise<MfaChallengeClaims> {
    const { payload } = await jwtVerify(token, this.mfaKey, {
      issuer: this.config.jwt.issuer,
      audience: `${this.config.jwt.audience}-mfa`,
      algorithms: ['HS256'],
    });
    if (
      payload.mfa !== true ||
      typeof payload.sub !== 'string' ||
      typeof payload.tid !== 'string'
    ) {
      throw new Error('Invalid MFA challenge token');
    }
    return payload as MfaChallengeClaims;
  }

  /** Generates a refresh token: 32 random bytes, base64url-encoded. */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Returns access TTL in seconds, used as the `expires_in` field. */
  accessTtlSeconds(): number {
    return parseDuration(this.config.jwt.accessTtl);
  }

  refreshTtlSeconds(): number {
    return parseDuration(this.config.jwt.refreshTtl);
  }

  driverTtlSeconds(): number {
    return parseDuration(this.config.jwt.driverTtl);
  }

  /**
   * Driver-app session token. `sub` is the literal string 'driver' (the
   * subject is the role, not the user — the linked human is identified by
   * `driverId`). Audience `…-driver` keeps the keyspace separate from
   * operator access tokens.
   */
  async signDriver(claims: { driverId: string; tid: string; jti: string }): Promise<string> {
    return new SignJWT({ ...claims, sub: 'driver' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.config.jwt.issuer)
      .setAudience(`${this.config.jwt.audience}-driver`)
      .setExpirationTime(this.config.jwt.driverTtl)
      .sign(this.driverKey);
  }

  async verifyDriver(token: string): Promise<DriverAccessClaims> {
    const { payload } = await jwtVerify(token, this.driverKey, {
      issuer: this.config.jwt.issuer,
      audience: `${this.config.jwt.audience}-driver`,
      algorithms: ['HS256'],
    });
    if (
      payload.sub !== 'driver' ||
      typeof payload.tid !== 'string' ||
      typeof payload.driverId !== 'string'
    ) {
      throw new Error('Invalid driver token');
    }
    return payload as DriverAccessClaims;
  }

  /** Returns portal-customer session TTL in seconds (the `expires_in`). */
  portalTtlSeconds(): number {
    return parseDuration(this.config.jwt.portalTtl);
  }

  /**
   * Customer-portal session token (Session 32). `sub` is the portal user id,
   * `cid` the bound customer id. Audience `…-portal` and a dedicated key keep
   * the keyspace separate from operator and driver tokens.
   */
  async signPortal(claims: {
    sub: string;
    cid: string;
    tid: string;
    jti: string;
  }): Promise<string> {
    return new SignJWT({ cid: claims.cid, tid: claims.tid })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setJti(claims.jti)
      .setIssuedAt()
      .setIssuer(this.config.jwt.issuer)
      .setAudience(`${this.config.jwt.audience}-portal`)
      .setExpirationTime(this.config.jwt.portalTtl)
      .sign(this.portalKey);
  }

  async verifyPortal(token: string): Promise<PortalAccessClaims> {
    const { payload } = await jwtVerify(token, this.portalKey, {
      issuer: this.config.jwt.issuer,
      audience: `${this.config.jwt.audience}-portal`,
      algorithms: ['HS256'],
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.tid !== 'string' ||
      typeof payload.cid !== 'string'
    ) {
      throw new Error('Invalid portal token');
    }
    return payload as PortalAccessClaims;
  bidderTtlSeconds(): number {
    return parseDuration(this.config.jwt.bidderTtl);
  }

  /**
   * Auction bidder session token (Session 33). `sub` is the literal string
   * 'bidder'; the human buyer is identified by `bidderId`. Audience
   * `…-bidder` keeps the keyspace separate from operator/driver tokens.
   */
  async signBidder(claims: { bidderId: string; tid: string; jti: string }): Promise<string> {
    return new SignJWT({ ...claims, sub: 'bidder' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.config.jwt.issuer)
      .setAudience(`${this.config.jwt.audience}-bidder`)
      .setExpirationTime(this.config.jwt.bidderTtl)
      .sign(this.bidderKey);
  }

  async verifyBidder(token: string): Promise<BidderAccessClaims> {
    const { payload } = await jwtVerify(token, this.bidderKey, {
      issuer: this.config.jwt.issuer,
      audience: `${this.config.jwt.audience}-bidder`,
      algorithms: ['HS256'],
    });
    if (
      payload.sub !== 'bidder' ||
      typeof payload.tid !== 'string' ||
      typeof payload.bidderId !== 'string'
    ) {
      throw new Error('Invalid bidder token');
    }
    return payload as BidderAccessClaims;
  }
}

function parseDuration(input: string): number {
  const m = /^(\d+)([smhd])$/.exec(input.trim());
  if (!m) {
    const n = Number.parseInt(input, 10);
    if (!Number.isFinite(n)) throw new Error(`Invalid duration: ${input}`);
    return n;
  }
  const value = Number.parseInt(m[1] ?? '0', 10);
  const unit = m[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };
  return value * (multipliers[unit ?? 's'] ?? 1);
}
