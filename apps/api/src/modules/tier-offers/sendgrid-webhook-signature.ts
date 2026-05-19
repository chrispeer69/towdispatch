/**
 * SendGrid Event Webhook signature verification — Session 4.
 *
 * SendGrid signs each event-webhook delivery using ECDSA over the P-256
 * curve (a.k.a. prime256v1 / secp256r1). The signed payload is the
 * concatenation of the timestamp header and the raw request body. The
 * signature is base64-encoded and uses the ASN.1/DER format produced
 * by OpenSSL — this is the same format Node's crypto.verify() consumes
 * out of the box, so we don't need any custom DER parsing.
 *
 * Reference:
 *   https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
 *
 * Headers:
 *   X-Twilio-Email-Event-Webhook-Signature  — base64-encoded DER signature
 *   X-Twilio-Email-Event-Webhook-Timestamp  — unix-seconds timestamp
 *
 * Public key configuration:
 *   SENDGRID_WEBHOOK_PUBLIC_KEY env var — the base64-encoded SPKI
 *     public key SendGrid surfaces in the event-webhook UI. We accept
 *     either bare base64 or a PEM-formatted block; both are common in
 *     the wild.
 *
 * Behavior in dev:
 *   When SENDGRID_WEBHOOK_PUBLIC_KEY is unset, callers may opt to skip
 *   verification entirely. This module exposes the verify function;
 *   the controller decides whether to call it. We log a warning at the
 *   controller layer so the omission is auditable.
 */
import { createPublicKey, createVerify } from 'node:crypto';

export const SENDGRID_SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
export const SENDGRID_TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

export interface SendGridSignatureInput {
  signatureBase64: string;
  timestamp: string;
  rawBody: string;
  /** Either bare base64 or a PEM block. */
  publicKey: string;
}

export interface SendGridSignatureResult {
  valid: boolean;
  reason?: string;
}

function toPem(publicKey: string): string {
  const trimmed = publicKey.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  // Bare base64 → wrap as SPKI PEM.
  const wrapped = trimmed.replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Verify a SendGrid event-webhook signature. Returns { valid: true } on
 * success and { valid: false, reason } on any failure (bad signature,
 * malformed key, decode error, etc.).
 */
export function verifySendGridSignature(input: SendGridSignatureInput): SendGridSignatureResult {
  if (!input.signatureBase64) return { valid: false, reason: 'missing_signature' };
  if (!input.timestamp) return { valid: false, reason: 'missing_timestamp' };
  if (!input.rawBody) return { valid: false, reason: 'missing_body' };
  if (!input.publicKey) return { valid: false, reason: 'missing_public_key' };
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey(toPem(input.publicKey));
  } catch (err) {
    return {
      valid: false,
      reason: `public_key_parse_error:${(err as Error).message}`,
    };
  }
  const verifier = createVerify('sha256');
  verifier.update(input.timestamp);
  verifier.update(input.rawBody);
  verifier.end();
  let sig: Buffer;
  try {
    sig = Buffer.from(input.signatureBase64, 'base64');
  } catch {
    return { valid: false, reason: 'signature_decode_error' };
  }
  let ok: boolean;
  try {
    ok = verifier.verify(key, sig);
  } catch (err) {
    return { valid: false, reason: `verify_error:${(err as Error).message}` };
  }
  return ok ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}
