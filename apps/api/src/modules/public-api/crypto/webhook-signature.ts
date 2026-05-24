/**
 * Webhook HMAC-SHA256 signing + verification (Session 29). Pure, unit-tested.
 *
 * Header format (Stripe-style, replay-resistant):
 *   X-TowCommand-Signature: t=<unixSeconds>,v1=<hex hmac>
 * where the HMAC is computed over the exact string `${t}.${rawBody}` using
 * the endpoint's signing secret. Consumers recompute and compare in constant
 * time, and reject timestamps outside a tolerance window to defeat replay.
 *
 * verifySignature is exported so the integration test (and the docs' example)
 * exercise the same code path a consumer would implement.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-TowCommand-Signature';
export const DELIVERY_ID_HEADER = 'X-TowCommand-Delivery-Id';
export const EVENT_TYPE_HEADER = 'X-TowCommand-Event';
/** Default replay tolerance for verification: 5 minutes. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function computeSignature(secret: string, rawBody: string, timestampSec: number): string {
  return createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
}

export function buildSignatureHeader(
  secret: string,
  rawBody: string,
  timestampSec: number,
): string {
  return `t=${timestampSec},v1=${computeSignature(secret, rawBody, timestampSec)}`;
}

interface ParsedHeader {
  t: number;
  v1: string;
}

export function parseSignatureHeader(header: string): ParsedHeader | null {
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k === undefined || v === undefined) continue;
    if (k.trim() === 't') {
      const n = Number(v.trim());
      if (Number.isFinite(n)) t = n;
    } else if (k.trim() === 'v1') {
      v1 = v.trim();
    }
  }
  if (t === null || v1 === null) return null;
  return { t, v1 };
}

function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify a presented signature header against the raw body. `nowSec` is
 * injectable for deterministic tests.
 */
export function verifySignature(
  secret: string,
  rawBody: string,
  header: string,
  opts: { toleranceSeconds?: number; nowSec?: number } = {},
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > tolerance) return false;
  const expected = computeSignature(secret, rawBody, parsed.t);
  return hexEqual(expected, parsed.v1);
}
