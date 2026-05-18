/**
 * EvidenceStorageProvider — the contract for handing the in-truck client
 * a presigned PUT URL to upload job evidence (photos / videos /
 * signatures) directly to object storage, and a short-lived GET URL for
 * playback in the dispatch UI.
 *
 * Implementations:
 *   - S3EvidenceStorageProvider: AWS S3 via @aws-sdk/client-s3 +
 *     @aws-sdk/s3-request-presigner. Active when S3_BUCKET +
 *     S3_REGION are set (real credentials come from the standard
 *     AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY chain, with the
 *     dispatch-specific S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY env
 *     vars as explicit overrides).
 *   - LocalStubEvidenceStorageProvider: fake URLs that point at a
 *     placeholder local route. Used when S3_BUCKET is unset (dev / CI /
 *     local docker). Does not actually persist bytes — it exists so the
 *     full HTTP shape works end-to-end without an S3 dependency in
 *     test environments.
 *
 * Object key convention (enforced by both providers):
 *   tenants/{tenantId}/job-evidence/{jobId}/{evidenceId}-{kind}.{ext}
 */
import type { JobEvidenceKind } from '@ustowdispatch/shared';

export interface PresignPutInput {
  tenantId: string;
  jobId: string;
  evidenceId: string;
  kind: JobEvidenceKind;
  contentType: string;
  sizeBytes: number;
}

export interface PresignedPut {
  /** Where the client uploads to (HTTP PUT). */
  url: string;
  /** Server-chosen object key, persisted on the evidence row. */
  key: string;
  /** Unix seconds when the URL stops working. Client must upload before this. */
  expiresAt: number;
  /** Optional headers the client MUST send with the PUT (S3 needs content-type). */
  requiredHeaders?: Record<string, string>;
}

export interface PresignGetInput {
  tenantId: string;
  key: string;
}

export interface PresignedGet {
  url: string;
  expiresAt: number;
}

export interface EvidenceStorageProvider {
  readonly id: string;
  /** Mint a server-signed PUT URL valid for ~5 minutes. */
  presignPut(input: PresignPutInput): Promise<PresignedPut>;
  /** Mint a short-lived GET URL the dispatch UI uses to render the asset. */
  presignGet(input: PresignGetInput): Promise<PresignedGet>;
}

/**
 * Build the canonical S3 object key for a piece of evidence. Pure;
 * deterministic; testable. Used by both providers + the unit tests.
 *
 * Extension is derived from the kind so the URL is human-skimmable in
 * dashboards / logs. Photos collapse to .jpg because we accept any
 * content-type and webp/heic should still render server-side via the
 * proxy. Signature is .png (transparent canvas).
 */
export function buildEvidenceKey(input: {
  tenantId: string;
  jobId: string;
  evidenceId: string;
  kind: JobEvidenceKind;
}): string {
  const ext = extensionForKind(input.kind);
  return `tenants/${input.tenantId}/job-evidence/${input.jobId}/${input.evidenceId}-${input.kind}.${ext}`;
}

function extensionForKind(kind: JobEvidenceKind): string {
  switch (kind) {
    case 'photo_pickup':
    case 'photo_dropoff':
    case 'photo_damage':
    case 'photo_hookup':
    case 'photo_release':
    case 'photo_other':
      return 'jpg';
    case 'video_walkaround':
    case 'video_other':
      return 'mp4';
    case 'signature_customer':
    case 'signature_driver':
      return 'png';
    case 'document_scan':
      return 'pdf';
    default:
      return 'bin';
  }
}
