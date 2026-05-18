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

@Injectable()
export class JwtService {
  private readonly accessKey: Uint8Array;
  private readonly mfaKey: Uint8Array;
  private readonly driverKey: Uint8Array;

  constructor(private readonly config: ConfigService) {
    this.accessKey = new TextEncoder().encode(config.jwt.accessSecret);
    this.mfaKey = new TextEncoder().encode(config.jwt.mfaSecret);
    this.driverKey = new TextEncoder().encode(config.jwt.driverSecret);
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
