/**
 * TierOfferTokenService — mints and verifies the per-recipient magic-link
 * token embedded in accept/decline URLs.
 *
 * Format (all parts base64url, no padding):
 *
 *     v1.<recipientId>.<expiryMs>.<nonce>.<sig>
 *
 *   - recipientId : the tier_offer_recipients.id (UUID), so the public
 *                   landing route can resolve the row WITHOUT a tenant
 *                   context — it reads the id straight from the token,
 *                   then the DB lookup confirms the stored token matches
 *                   byte-for-byte (defense in depth: a forged token with
 *                   a real id still fails the column comparison).
 *   - expiryMs    : absolute expiry (ms since epoch). Checked on verify
 *                   so a token is dead even if the row's status lags.
 *   - nonce       : 12 random bytes, so two recipients minted in the same
 *                   millisecond never collide on the global unique index
 *                   and the token is unguessable from id + expiry alone.
 *   - sig         : HMAC-SHA-256 over "v1.<recipientId>.<expiryMs>.<nonce>"
 *                   keyed by TIER_OFFER_MAGIC_LINK_SECRET, compared in
 *                   constant time.
 *
 * The token is stored verbatim in tier_offer_recipients.magic_link_token,
 * which carries a GLOBAL unique index — token uniqueness across tenants is
 * what lets the public route resolve a recipient before any tenant scope
 * is established without leaking foreign rows.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';

const TOKEN_VERSION = 'v1';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface MintedToken {
  token: string;
  expiresAt: Date;
}

export interface VerifiedToken {
  recipientId: string;
  expiresAt: Date;
}

const b64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

const fromB64url = (input: string): string => Buffer.from(input, 'base64url').toString('utf8');

@Injectable()
export class TierOfferTokenService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Mint a token for a recipient. `deadlineAt` is the offer's
   * acceptance_deadline_at; the magic link stays clickable for
   * TIER_OFFER_MAGIC_LINK_TTL_DAYS *past* that deadline so a late click
   * resolves to a friendly "no longer accepting" page rather than a 404.
   */
  mint(recipientId: string, deadlineAt: Date): MintedToken {
    const ttlMs = this.config.tierOffers.magicLinkTtlDays * MS_PER_DAY;
    const expiresAt = new Date(deadlineAt.getTime() + ttlMs);
    const expiryMs = expiresAt.getTime();
    // A random nonce folded into the signed payload guarantees two
    // recipients minted in the same millisecond never collide on the
    // global unique index, and makes the token unguessable even with a
    // known recipientId + expiry.
    const nonce = b64url(randomBytes(12));
    const body = `${TOKEN_VERSION}.${b64url(recipientId)}.${expiryMs}.${nonce}`;
    const sig = this.sign(body);
    return { token: `${body}.${sig}`, expiresAt };
  }

  /**
   * Verify signature + expiry and return the embedded recipientId.
   * Returns null on any malformed / tampered / expired token — the caller
   * renders the same "invalid or expired link" page for all of them so we
   * don't leak which failure mode occurred.
   */
  verify(token: string, now: Date = new Date()): VerifiedToken | null {
    const parts = token.split('.');
    if (parts.length !== 5) return null;
    const [version, encId, expiryStr, nonce, sig] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (version !== TOKEN_VERSION) return null;

    const body = `${version}.${encId}.${expiryStr}.${nonce}`;
    if (!this.verifySignature(body, sig)) return null;

    const expiryMs = Number(expiryStr);
    if (!Number.isFinite(expiryMs)) return null;
    const expiresAt = new Date(expiryMs);
    if (now.getTime() > expiryMs) return null;

    let recipientId: string;
    try {
      recipientId = fromB64url(encId);
    } catch {
      return null;
    }
    if (recipientId.length === 0) return null;

    return { recipientId, expiresAt };
  }

  private sign(body: string): string {
    return createHmac('sha256', this.config.tierOffers.magicLinkSecret)
      .update(body)
      .digest('base64url');
  }

  private verifySignature(body: string, providedSig: string): boolean {
    const expected = this.sign(body);
    const a = Buffer.from(expected);
    const b = Buffer.from(providedSig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
