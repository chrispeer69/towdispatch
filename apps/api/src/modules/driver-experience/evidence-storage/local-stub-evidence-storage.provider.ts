/**
 * LocalStubEvidenceStorageProvider — the default when S3_BUCKET is
 * unset. Hands out fake presigned URLs that point at a local stub
 * route. The driver app's HTTP shape stays identical to production —
 * /presign → PUT to a URL → /finalize — so the integration tests
 * exercise the full code path without an S3 dependency.
 *
 * The URL itself is not actually wired to anything that stores bytes.
 * Tests that need to assert "evidence was uploaded" should do so by
 * checking the job_evidence row state after /finalize, not by reading
 * back the bytes.
 */
import { Injectable } from '@nestjs/common';
import {
  type EvidenceStorageProvider,
  type GenerateThumbnailInput,
  type PresignGetInput,
  type PresignGetThumbnailInput,
  type PresignPutInput,
  type PresignedGet,
  type PresignedPut,
  buildEvidenceKey,
  isThumbnailableKind,
} from './evidence-storage.provider.js';

const STUB_TTL_SECONDS = 5 * 60;

@Injectable()
export class LocalStubEvidenceStorageProvider implements EvidenceStorageProvider {
  readonly id = 'local-stub';

  constructor(private readonly publicBaseUrl: string) {}

  async presignPut(input: PresignPutInput): Promise<PresignedPut> {
    const key = buildEvidenceKey(input);
    const url = `${this.publicBaseUrl}/__stub-evidence-upload/${encodeURIComponent(key)}?token=stub`;
    return {
      url,
      key,
      expiresAt: Math.floor(Date.now() / 1000) + STUB_TTL_SECONDS,
      requiredHeaders: { 'content-type': input.contentType },
    };
  }

  async presignGet(input: PresignGetInput): Promise<PresignedGet> {
    if (!input.key.startsWith(`tenants/${input.tenantId}/`)) {
      throw new Error('Cross-tenant key access denied');
    }
    const url = `${this.publicBaseUrl}/__stub-evidence-download/${encodeURIComponent(input.key)}?token=stub`;
    return { url, expiresAt: Math.floor(Date.now() / 1000) + STUB_TTL_SECONDS };
  }

  /**
   * Dev/CI has no thumbnail-generation pipeline, so we point the
   * thumbnail at the source asset's stub URL. The HTTP shape (a non-null
   * URL for thumbnailable kinds, null otherwise) matches production.
   */
  async presignGetThumbnail(input: PresignGetThumbnailInput): Promise<PresignedGet | null> {
    if (!isThumbnailableKind(input.kind)) return null;
    if (!input.key.startsWith(`tenants/${input.tenantId}/`)) {
      throw new Error('Cross-tenant key access denied');
    }
    const url = `${this.publicBaseUrl}/__stub-evidence-download/${encodeURIComponent(input.key)}?token=stub&thumb=1`;
    return { url, expiresAt: Math.floor(Date.now() / 1000) + STUB_TTL_SECONDS };
  }

  /**
   * The stub never persisted the source bytes, so there is nothing to resize.
   * Returns false; `presignGetThumbnail` already points dev/CI at the source
   * asset's stub URL, so the operator console still renders a tile.
   */
  async generateThumbnail(_input: GenerateThumbnailInput): Promise<boolean> {
    return false;
  }
}
