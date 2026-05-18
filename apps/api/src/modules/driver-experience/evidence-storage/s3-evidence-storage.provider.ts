/**
 * S3EvidenceStorageProvider — real AWS S3 implementation. Selected when
 * S3_BUCKET + S3_REGION env vars are present. Credentials come from
 * either S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY (dispatch-specific
 * overrides) or the standard AWS_* chain.
 *
 * PUT URLs are signed for 5 minutes; GET URLs for 5 minutes. Both
 * windows are tight enough that a leaked URL is mostly useless and a
 * legitimate driver upload still has plenty of slack on a 4G/LTE
 * connection.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import {
  type EvidenceStorageProvider,
  type PresignGetInput,
  type PresignPutInput,
  type PresignedGet,
  type PresignedPut,
  buildEvidenceKey,
} from './evidence-storage.provider.js';

const PUT_TTL_SECONDS = 5 * 60;
const GET_TTL_SECONDS = 5 * 60;

export interface S3StorageConfig {
  bucket: string;
  region: string;
  /** Optional explicit creds. Falls back to the standard AWS chain when null. */
  accessKeyId: string | null;
  secretAccessKey: string | null;
  /** S3-compatible endpoints (MinIO, R2) — null for AWS S3. */
  endpoint: string | null;
  /** Force path-style addressing (MinIO requires it). */
  forcePathStyle: boolean;
}

@Injectable()
export class S3EvidenceStorageProvider implements EvidenceStorageProvider {
  readonly id = 's3';
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async presignPut(input: PresignPutInput): Promise<PresignedPut> {
    const key = buildEvidenceKey(input);
    const cmd = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: PUT_TTL_SECONDS });
    return {
      url,
      key,
      expiresAt: Math.floor(Date.now() / 1000) + PUT_TTL_SECONDS,
      requiredHeaders: { 'content-type': input.contentType },
    };
  }

  async presignGet(input: PresignGetInput): Promise<PresignedGet> {
    // Tenant-prefix check — the s3 key must live under this tenant's
    // root or we refuse to sign. Defense in depth on top of RLS / the
    // service-layer filter.
    if (!input.key.startsWith(`tenants/${input.tenantId}/`)) {
      throw new Error('Cross-tenant key access denied');
    }
    const cmd = new GetObjectCommand({ Bucket: this.config.bucket, Key: input.key });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: GET_TTL_SECONDS });
    return { url, expiresAt: Math.floor(Date.now() / 1000) + GET_TTL_SECONDS };
  }
}
