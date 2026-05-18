/**
 * Unit coverage for the evidence presign helpers. Shape-only — no real
 * S3 traffic. The presign call is deterministic enough at the URL level
 * (host, query keys, expiry bounds) that we can assert against it
 * without needing an integration environment.
 */
import { describe, expect, it } from 'vitest';
import { buildEvidenceKey } from './evidence-storage.provider.js';
import { LocalStubEvidenceStorageProvider } from './local-stub-evidence-storage.provider.js';
import { S3EvidenceStorageProvider } from './s3-evidence-storage.provider.js';

describe('buildEvidenceKey', () => {
  it('produces a deterministic, tenant-prefixed key', () => {
    const key = buildEvidenceKey({
      tenantId: '00000000-0000-7000-8000-000000000001',
      jobId: '00000000-0000-7000-8000-000000000002',
      evidenceId: '00000000-0000-7000-8000-000000000003',
      kind: 'photo_pickup',
    });
    expect(key).toBe(
      'tenants/00000000-0000-7000-8000-000000000001/job-evidence/00000000-0000-7000-8000-000000000002/00000000-0000-7000-8000-000000000003-photo_pickup.jpg',
    );
  });
});

describe('S3EvidenceStorageProvider', () => {
  const provider = new S3EvidenceStorageProvider({
    bucket: 'test-evidence-bucket',
    region: 'us-east-2',
    accessKeyId: 'AKIATESTTEST',
    secretAccessKey: 'secrettestsecret',
    endpoint: null,
    forcePathStyle: false,
  });

  it('mints a presigned PUT URL with the canonical key and content-type header', async () => {
    const result = await provider.presignPut({
      tenantId: '00000000-0000-7000-8000-000000000001',
      jobId: '00000000-0000-7000-8000-000000000002',
      evidenceId: '00000000-0000-7000-8000-000000000003',
      kind: 'photo_pickup',
      contentType: 'image/jpeg',
      sizeBytes: 123_456,
    });
    expect(result.key).toContain('tenants/00000000-0000-7000-8000-000000000001/job-evidence/');
    expect(result.url).toContain('test-evidence-bucket');
    expect(result.url).toMatch(/X-Amz-Signature=/);
    expect(result.url).toMatch(/X-Amz-Expires=300/);
    expect(result.requiredHeaders?.['content-type']).toBe('image/jpeg');
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('refuses to presign a GET URL for a foreign-tenant key', async () => {
    await expect(
      provider.presignGet({
        tenantId: '00000000-0000-7000-8000-000000000001',
        key: 'tenants/00000000-0000-7000-8000-000000000099/job-evidence/foo/bar.jpg',
      }),
    ).rejects.toThrow(/cross-tenant/i);
  });
});

describe('LocalStubEvidenceStorageProvider', () => {
  const provider = new LocalStubEvidenceStorageProvider('http://localhost:3001');

  it('hands out a stub PUT URL that round-trips the canonical key', async () => {
    const result = await provider.presignPut({
      tenantId: '00000000-0000-7000-8000-000000000001',
      jobId: '00000000-0000-7000-8000-000000000002',
      evidenceId: '00000000-0000-7000-8000-000000000003',
      kind: 'signature_customer',
      contentType: 'image/png',
      sizeBytes: 9001,
    });
    expect(result.key).toContain('signature_customer.png');
    expect(result.url).toContain('/__stub-evidence-upload/');
    expect(result.url).toContain(encodeURIComponent(result.key));
    expect(result.requiredHeaders?.['content-type']).toBe('image/png');
  });
});
