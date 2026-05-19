/**
 * Unit tests for the SendGrid event-webhook signature verifier.
 *
 * We generate a fresh ECDSA P-256 key pair per test, sign a known
 * (timestamp, body) tuple, and feed the result through the verifier.
 * This proves the verifier is doing real ECDSA verification — not a
 * stub or a checksum compare — without needing a real SendGrid key.
 */
import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySendGridSignature } from './sendgrid-webhook-signature.js';

function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

function signTuple(timestamp: string, rawBody: string, privateKeyPem: string): string {
  const signer = createSign('sha256');
  signer.update(timestamp);
  signer.update(rawBody);
  signer.end();
  return signer.sign(privateKeyPem).toString('base64');
}

describe('verifySendGridSignature', () => {
  it('returns valid for a correctly signed payload (PEM key)', () => {
    const { publicKeyPem, privateKeyPem } = newKeyPair();
    const timestamp = '1763500000';
    const rawBody = '[{"event":"delivered","recipientId":"r1","kind":"tier-offer-invitation"}]';
    const signature = signTuple(timestamp, rawBody, privateKeyPem);
    const out = verifySendGridSignature({
      signatureBase64: signature,
      timestamp,
      rawBody,
      publicKey: publicKeyPem,
    });
    expect(out.valid).toBe(true);
  });

  it('accepts a bare-base64 SPKI public key (PEM-less)', () => {
    const { publicKeyPem, privateKeyPem } = newKeyPair();
    const timestamp = '1763500001';
    const rawBody = '[]';
    const signature = signTuple(timestamp, rawBody, privateKeyPem);
    // Strip PEM markers + whitespace so the verifier has to wrap.
    const bareBase64 = publicKeyPem
      .replace(/-----BEGIN [A-Z ]+-----/g, '')
      .replace(/-----END [A-Z ]+-----/g, '')
      .replace(/\s+/g, '');
    const out = verifySendGridSignature({
      signatureBase64: signature,
      timestamp,
      rawBody,
      publicKey: bareBase64,
    });
    expect(out.valid).toBe(true);
  });

  it('rejects when the body has been tampered', () => {
    const { publicKeyPem, privateKeyPem } = newKeyPair();
    const timestamp = '1763500002';
    const rawBody = '[{"event":"delivered","recipientId":"r1"}]';
    const signature = signTuple(timestamp, rawBody, privateKeyPem);
    const out = verifySendGridSignature({
      signatureBase64: signature,
      timestamp,
      rawBody: rawBody.replace('delivered', 'bounce'),
      publicKey: publicKeyPem,
    });
    expect(out.valid).toBe(false);
    expect(out.reason).toBe('signature_mismatch');
  });

  it('rejects when the timestamp has been tampered', () => {
    const { publicKeyPem, privateKeyPem } = newKeyPair();
    const timestamp = '1763500003';
    const rawBody = '[]';
    const signature = signTuple(timestamp, rawBody, privateKeyPem);
    const out = verifySendGridSignature({
      signatureBase64: signature,
      timestamp: '9999999999',
      rawBody,
      publicKey: publicKeyPem,
    });
    expect(out.valid).toBe(false);
    expect(out.reason).toBe('signature_mismatch');
  });

  it('rejects when the public key is not the one that signed', () => {
    const { privateKeyPem } = newKeyPair();
    const otherPair = newKeyPair();
    const timestamp = '1763500004';
    const rawBody = '[]';
    const signature = signTuple(timestamp, rawBody, privateKeyPem);
    const out = verifySendGridSignature({
      signatureBase64: signature,
      timestamp,
      rawBody,
      publicKey: otherPair.publicKeyPem,
    });
    expect(out.valid).toBe(false);
    expect(out.reason).toBe('signature_mismatch');
  });

  it('rejects on missing fields', () => {
    expect(
      verifySendGridSignature({ signatureBase64: '', timestamp: 't', rawBody: 'b', publicKey: 'k' })
        .valid,
    ).toBe(false);
    expect(
      verifySendGridSignature({ signatureBase64: 's', timestamp: '', rawBody: 'b', publicKey: 'k' })
        .valid,
    ).toBe(false);
    expect(
      verifySendGridSignature({ signatureBase64: 's', timestamp: 't', rawBody: '', publicKey: 'k' })
        .valid,
    ).toBe(false);
    expect(
      verifySendGridSignature({ signatureBase64: 's', timestamp: 't', rawBody: 'b', publicKey: '' })
        .valid,
    ).toBe(false);
  });

  it('returns a parseable reason on a malformed public key', () => {
    const out = verifySendGridSignature({
      signatureBase64: 'AAAA',
      timestamp: 't',
      rawBody: 'b',
      publicKey: 'definitely-not-a-key',
    });
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/public_key_parse_error/);
  });
});
