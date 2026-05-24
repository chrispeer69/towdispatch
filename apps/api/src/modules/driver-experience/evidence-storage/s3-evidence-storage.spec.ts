/**
 * Unit coverage for the evidence presign helpers. Shape-only — no real
 * S3 traffic. The presign call is deterministic enough at the URL level
 * (host, query keys, expiry bounds) that we can assert against it
 * without needing an integration environment.
 */
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  buildEvidenceKey,
  buildThumbnailKey,
  isThumbnailableKind,
} from './evidence-storage.provider.js';
import { LocalStubEvidenceStorageProvider } from './local-stub-evidence-storage.provider.js';
import { S3EvidenceStorageProvider } from './s3-evidence-storage.provider.js';

/** Replace the provider's private S3Client.send with a spy. */
function stubSend(
  provider: S3EvidenceStorageProvider,
  impl: (cmd: unknown) => Promise<unknown>,
): ReturnType<typeof vi.fn> {
  const send = vi.fn(impl);
  (provider as unknown as { client: { send: typeof send } }).client.send = send;
  return send;
}

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

describe('buildThumbnailKey', () => {
  it('nests under thumbnails/ and keeps the .jpg extension for a photo', () => {
    const src = 'tenants/t1/job-evidence/j1/00000000-0000-7000-8000-000000000003-photo_pickup.jpg';
    expect(buildThumbnailKey(src)).toBe(
      'tenants/t1/job-evidence/j1/thumbnails/00000000-0000-7000-8000-000000000003-photo_pickup.jpg',
    );
  });

  it('rewrites a video .mp4 source to a .jpg poster key', () => {
    const src = 'tenants/t1/job-evidence/j1/evid-video_walkaround.mp4';
    expect(buildThumbnailKey(src)).toBe(
      'tenants/t1/job-evidence/j1/thumbnails/evid-video_walkaround.jpg',
    );
  });
});

describe('isThumbnailableKind', () => {
  it('is true for photos, signatures and videos', () => {
    expect(isThumbnailableKind('photo_damage')).toBe(true);
    expect(isThumbnailableKind('signature_driver')).toBe(true);
    expect(isThumbnailableKind('video_walkaround')).toBe(true);
  });
  it('is false for documents and the catch-all', () => {
    expect(isThumbnailableKind('document_scan')).toBe(false);
    expect(isThumbnailableKind('other')).toBe(false);
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

  it('signs a thumbnail GET for a thumbnailable kind and returns null otherwise', async () => {
    const photo = await provider.presignGetThumbnail({
      tenantId: '00000000-0000-7000-8000-000000000001',
      key: 'tenants/00000000-0000-7000-8000-000000000001/job-evidence/j1/evid-photo_damage.jpg',
      kind: 'photo_damage',
    });
    expect(photo).not.toBeNull();
    expect(photo?.url).toMatch(/X-Amz-Signature=/);
    // The signed key must point at the derived thumbnails/ path.
    expect(decodeURIComponent(photo?.url ?? '')).toContain('/thumbnails/');

    const doc = await provider.presignGetThumbnail({
      tenantId: '00000000-0000-7000-8000-000000000001',
      key: 'tenants/00000000-0000-7000-8000-000000000001/job-evidence/j1/evid-document_scan.pdf',
      kind: 'document_scan',
    });
    expect(doc).toBeNull();
  });
});

describe('S3EvidenceStorageProvider.generateThumbnail', () => {
  const TENANT = '00000000-0000-7000-8000-000000000001';
  const PHOTO_KEY = `tenants/${TENANT}/job-evidence/j1/evid-photo_damage.jpg`;

  function makeProvider(): S3EvidenceStorageProvider {
    return new S3EvidenceStorageProvider({
      bucket: 'test-evidence-bucket',
      region: 'us-east-2',
      accessKeyId: 'AKIATESTTEST',
      secretAccessKey: 'secrettestsecret',
      endpoint: null,
      forcePathStyle: false,
    });
  }

  it('resizes an image to a 200x200 jpeg and PUTs it at the derived thumbnail key', async () => {
    const provider = makeProvider();
    const source = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const sent: unknown[] = [];
    const send = stubSend(provider, async (cmd) => {
      sent.push(cmd);
      if (cmd instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => new Uint8Array(source) } };
      }
      return {};
    });

    const wrote = await provider.generateThumbnail({
      tenantId: TENANT,
      key: PHOTO_KEY,
      kind: 'photo_damage',
      contentType: 'image/jpeg',
      sizeBytes: source.length,
    });

    expect(wrote).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const put = sent.find((c): c is PutObjectCommand => c instanceof PutObjectCommand);
    expect(put).toBeDefined();
    expect(put?.input.Key).toBe(
      `tenants/${TENANT}/job-evidence/j1/thumbnails/evid-photo_damage.jpg`,
    );
    expect(put?.input.ContentType).toBe('image/jpeg');
    const meta = await sharp(put?.input.Body as Buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
  });

  it('skips a video kind without touching S3 (Sharp cannot decode video)', async () => {
    const provider = makeProvider();
    const send = stubSend(provider, async () => ({}));
    const wrote = await provider.generateThumbnail({
      tenantId: TENANT,
      key: `tenants/${TENANT}/job-evidence/j1/evid-video_walkaround.mp4`,
      kind: 'video_walkaround',
      contentType: 'video/mp4',
      sizeBytes: 1000,
    });
    expect(wrote).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('skips a non-image content-type', async () => {
    const provider = makeProvider();
    const send = stubSend(provider, async () => ({}));
    const wrote = await provider.generateThumbnail({
      tenantId: TENANT,
      key: PHOTO_KEY,
      kind: 'photo_damage',
      contentType: 'application/octet-stream',
      sizeBytes: 1000,
    });
    expect(wrote).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('skips an oversized source image', async () => {
    const provider = makeProvider();
    const send = stubSend(provider, async () => ({}));
    const wrote = await provider.generateThumbnail({
      tenantId: TENANT,
      key: PHOTO_KEY,
      kind: 'photo_damage',
      contentType: 'image/jpeg',
      sizeBytes: 26 * 1024 * 1024,
    });
    expect(wrote).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a cross-tenant key', async () => {
    const provider = makeProvider();
    await expect(
      provider.generateThumbnail({
        tenantId: TENANT,
        key: 'tenants/00000000-0000-7000-8000-000000000099/job-evidence/j1/x.jpg',
        kind: 'photo_damage',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
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

  it('returns a stub thumbnail URL for a thumbnailable kind, null otherwise', async () => {
    const photo = await provider.presignGetThumbnail({
      tenantId: '00000000-0000-7000-8000-000000000001',
      key: 'tenants/00000000-0000-7000-8000-000000000001/job-evidence/j1/evid-photo_pickup.jpg',
      kind: 'photo_pickup',
    });
    expect(photo?.url).toContain('/__stub-evidence-download/');
    expect(photo?.url).toContain('thumb=1');

    const other = await provider.presignGetThumbnail({
      tenantId: '00000000-0000-7000-8000-000000000001',
      key: 'tenants/00000000-0000-7000-8000-000000000001/job-evidence/j1/evid-other.bin',
      kind: 'other',
    });
    expect(other).toBeNull();
  });

  it('generateThumbnail is a no-op (the stub holds no real bytes to resize)', async () => {
    const wrote = await provider.generateThumbnail({
      tenantId: '00000000-0000-7000-8000-000000000001',
      key: 'tenants/00000000-0000-7000-8000-000000000001/job-evidence/j1/evid-photo_pickup.jpg',
      kind: 'photo_pickup',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });
    expect(wrote).toBe(false);
  });
});
