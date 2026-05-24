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

export interface PresignGetThumbnailInput {
  tenantId: string;
  /** The evidence object key (the full-size asset). */
  key: string;
  kind: JobEvidenceKind;
}

export interface GenerateThumbnailInput {
  tenantId: string;
  /** The full-size asset key the thumbnail is derived from. */
  key: string;
  kind: JobEvidenceKind;
  /** Source content-type — only `image/*` is processable in-process. */
  contentType: string;
  /** Source size in bytes — oversized images are skipped. */
  sizeBytes: number;
}

/**
 * Largest source image we resize in-process. A phone photo is a few MB; this
 * 25MB ceiling bounds the buffer pulled into API memory. Anything larger is
 * skipped (the UI falls back to the full-size asset).
 */
export const MAX_THUMBNAIL_SOURCE_BYTES = 25 * 1024 * 1024;

/** Square thumbnail edge in px — matches the operator-console grid tile. */
export const THUMBNAIL_EDGE_PX = 200;

export interface EvidenceStorageProvider {
  readonly id: string;
  /** Mint a server-signed PUT URL valid for ~5 minutes. */
  presignPut(input: PresignPutInput): Promise<PresignedPut>;
  /** Mint a short-lived GET URL the dispatch UI uses to render the asset. */
  presignGet(input: PresignGetInput): Promise<PresignedGet>;
  /**
   * Mint a short-lived GET URL for the 200x200 jpg thumbnail derived from
   * an uploaded asset. Returns null for kinds that have no thumbnail
   * (documents / other). For image evidence the thumbnail object is written
   * by `generateThumbnail` on finalize; video posters are produced by the
   * storage tier (S3 event → ffmpeg Lambda). This only signs the derived
   * key. Dev/CI stubs may return the source asset URL.
   */
  presignGetThumbnail(input: PresignGetThumbnailInput): Promise<PresignedGet | null>;
  /**
   * Resize an uploaded **image** asset to a {@link THUMBNAIL_EDGE_PX}px square
   * jpeg and write it at {@link buildThumbnailKey}. Returns `true` when a
   * thumbnail object was written, `false` when skipped (non-image kind,
   * non-`image/*` content-type, oversized source, or a no-byte stub). Callers
   * MUST treat this as best-effort — a thrown error must never fail finalize.
   * Video posters are out of scope (Sharp can't decode video; that stays an
   * ffmpeg/Lambda concern).
   */
  generateThumbnail(input: GenerateThumbnailInput): Promise<boolean>;
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

/**
 * Kinds that get a generated thumbnail: still photos, signatures (raster
 * canvases), and videos (a poster frame). Documents (pdf) and the catch-all
 * `other` have no thumbnail — the UI shows a type icon instead.
 */
export function isThumbnailableKind(kind: JobEvidenceKind): boolean {
  return kind.startsWith('photo_') || kind.startsWith('signature_') || kind.startsWith('video_');
}

/**
 * Derive the thumbnail object key from a full-size evidence key. The
 * thumbnail lives under a sibling `thumbnails/` prefix and is ALWAYS a
 * `.jpg` (a video's `.mp4` source yields a `.jpg` poster). Pure +
 * deterministic so both providers and the tests agree on the key.
 *
 * `tenants/{t}/job-evidence/{job}/{id}-{kind}.{ext}`
 *   → `tenants/{t}/job-evidence/{job}/thumbnails/{id}-{kind}.jpg`
 */
export function buildThumbnailKey(evidenceKey: string): string {
  const slash = evidenceKey.lastIndexOf('/');
  const dir = evidenceKey.slice(0, slash);
  const file = evidenceKey.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const base = dot === -1 ? file : file.slice(0, dot);
  return `${dir}/thumbnails/${base}.jpg`;
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
