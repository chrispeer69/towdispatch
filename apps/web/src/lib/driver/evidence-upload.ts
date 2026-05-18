'use client';

/**
 * Evidence upload helper — presign → PUT → finalize.
 *
 * Used by both the pretrip page (photos for FAIL items) and the job
 * execution page (walkaround photos, video, signature). Returns the
 * evidence id + s3Key the caller persists in its form state.
 *
 * S3 PUT uses raw fetch (not driverApi) because the presigned URL is
 * pre-authenticated and doesn't want our Bearer header.
 */
import type { JobEvidenceKind } from '@ustowdispatch/shared';
import { driverApi } from './api-client';
import type { JobEvidencePresignResponse } from './types';

export interface UploadEvidenceInput {
  jobId: string;
  kind: JobEvidenceKind;
  file: Blob;
  capturedLat?: number;
  capturedLng?: number;
}

export interface UploadEvidenceResult {
  evidenceId: string;
  s3Key: string;
}

export async function uploadEvidence(input: UploadEvidenceInput): Promise<UploadEvidenceResult> {
  const presign = await driverApi<JobEvidencePresignResponse>('POST', '/job-evidence/presign', {
    jobId: input.jobId,
    kind: input.kind,
    contentType: input.file.type || 'application/octet-stream',
    sizeBytes: input.file.size,
  });
  const headers: Record<string, string> = {
    'content-type': input.file.type || 'application/octet-stream',
    ...(presign.upload.requiredHeaders ?? {}),
  };
  const putRes = await fetch(presign.upload.url, {
    method: 'PUT',
    headers,
    body: input.file,
  });
  if (!putRes.ok) {
    // Tell the API the upload failed so it can clean up the record.
    try {
      await driverApi('POST', `/job-evidence/${presign.evidence.id}/fail`, {
        reason: `S3 PUT failed with ${putRes.status}`,
      });
    } catch {
      // best-effort
    }
    throw new Error(`Upload failed (${putRes.status})`);
  }
  const finalizeBody: Record<string, unknown> = {};
  if (input.capturedLat != null) finalizeBody.capturedLat = input.capturedLat;
  if (input.capturedLng != null) finalizeBody.capturedLng = input.capturedLng;
  await driverApi('POST', `/job-evidence/${presign.evidence.id}/finalize`, finalizeBody);
  return { evidenceId: presign.evidence.id, s3Key: presign.evidence.s3Key };
}
