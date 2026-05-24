/**
 * Self-serve portal session token (Session 55).
 *
 * A signed, stateless cookie value: base64url(payload).base64url(HMAC-SHA256).
 * NOT a JWT and NOT the operator/driver/portal JWT realm — self-serve sessions
 * are per-impound and carry their own minimal claims (SESSION_55_DECISIONS.md
 * D5). Pure (secret + clock injected) so signing/expiry is unit-tested without
 * NestJS. Verification is constant-time on the signature and enforces expiry.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionTokenPayload {
  /** customer_portal_sessions.id */
  sid: string;
  /** tenant id (RLS scope) */
  tid: string;
  /** impound id this session is bound to */
  iid: string;
  /** issued-at (epoch seconds) */
  iat: number;
  /** expires-at (epoch seconds) */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(body: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(body).digest());
}

/** Sign a session payload. `nowSeconds` + `ttlSeconds` set iat/exp. */
export function signSessionToken(
  claims: Pick<SessionTokenPayload, 'sid' | 'tid' | 'iid'>,
  secret: string,
  nowSeconds: number,
  ttlSeconds: number,
): string {
  const payload: SessionTokenPayload = {
    ...claims,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body, secret)}`;
}

/**
 * Verify + decode. Returns the payload, or null when the shape is wrong, the
 * signature mismatches, or the token has expired at `nowSeconds`.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number,
): SessionTokenPayload | null {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as SessionTokenPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.sid !== 'string' ||
    typeof payload.tid !== 'string' ||
    typeof payload.iid !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    return null;
  }
  if (payload.exp <= nowSeconds) return null;
  return payload;
}

/** Re-issue with a fresh window (sliding session) without re-reading claims. */
export function slideSessionToken(
  payload: SessionTokenPayload,
  secret: string,
  nowSeconds: number,
  ttlSeconds: number,
): string {
  return signSessionToken(
    { sid: payload.sid, tid: payload.tid, iid: payload.iid },
    secret,
    nowSeconds,
    ttlSeconds,
  );
}
