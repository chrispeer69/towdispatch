/**
 * DriverEvidenceService — manages job_evidence rows and brokers
 * presigned upload / download URLs via the EvidenceStorageProvider.
 *
 * CRITICAL: this service never proxies bytes. The driver app uploads
 * directly to object storage with a server-issued presigned URL; we
 * just track the row's lifecycle (`pending` → `uploaded` → `failed`).
 * That keeps the API instance from buffering 100MB videos in process
 * memory and lets the same code path scale to thousands of concurrent
 * drivers without a queue.
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { driverShifts, jobEvidence, jobs, uuidv7 } from '@ustowdispatch/db';
import { ERROR_CODES, type JobEvidenceDto, type JobEvidenceKind } from '@ustowdispatch/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import type { EvidenceStorageProvider } from './evidence-storage/evidence-storage.provider.js';
import { EVIDENCE_STORAGE_PROVIDER } from './evidence-storage/evidence-storage.tokens.js';

export interface PresignEvidencePayload {
  jobId: string;
  kind: JobEvidenceKind;
  contentType: string;
  sizeBytes: number;
}

export interface FinalizeEvidencePayload {
  width?: number | undefined;
  height?: number | undefined;
  durationSeconds?: number | undefined;
  capturedLat?: number | undefined;
  capturedLng?: number | undefined;
}

export interface FailEvidencePayload {
  reason: string;
}

export interface JobEvidenceWithUrlDto extends JobEvidenceDto {
  /** Short-lived presigned GET URL — null for items still in `pending`. */
  downloadUrl: string | null;
  downloadUrlExpiresAt: number | null;
}

/** Unified actor for surfaces accepting BOTH driver + operator JWTs. */
interface DriverOrOperatorActor {
  tenantId: string;
  /** driverId for driver-token actors; userId for operator-token actors. */
  actorId: string;
  /** present only when the caller authed as a driver. */
  driverId: string | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class DriverEvidenceService {
  constructor(
    private readonly db: TenantAwareDb,
    @Inject(EVIDENCE_STORAGE_PROVIDER)
    private readonly storage: EvidenceStorageProvider,
  ) {}

  /**
   * Stage the evidence row in `pending` and return a presigned PUT URL
   * for the client to upload to. The row + the URL share a single
   * server-chosen s3_key so finalize can find the row by id (not by
   * key).
   */
  async presign(
    actor: DriverOrOperatorActor,
    input: PresignEvidencePayload,
  ): Promise<{
    evidence: JobEvidenceDto;
    upload: {
      url: string;
      key: string;
      expiresAt: number;
      requiredHeaders?: Record<string, string>;
    };
  }> {
    // Defensive cap; the shared zod schema accepts up to 5GB but we
    // don't want a buggy client to lock up a finalize tx with a
    // multi-day file. 500MB is more than enough for a walkaround video.
    const MAX_EVIDENCE_BYTES = 500 * 1024 * 1024;
    if (input.sizeBytes > MAX_EVIDENCE_BYTES) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `evidence file too large (>${MAX_EVIDENCE_BYTES} bytes)`,
      });
    }

    return this.db.runInTenantContext(this.toTenantCtx(actor), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, input.jobId), isNull(jobs.deletedAt)),
        columns: { id: true },
      });
      if (!job) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Job not found',
        });
      }

      const id = uuidv7();
      const presign = await this.storage.presignPut({
        tenantId: actor.tenantId,
        jobId: input.jobId,
        evidenceId: id,
        kind: input.kind,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      });

      const driverShiftId = actor.driverId ? await resolveActiveShiftId(tx, actor.driverId) : null;

      const [row] = await tx
        .insert(jobEvidence)
        .values({
          id,
          tenantId: actor.tenantId,
          jobId: input.jobId,
          driverId: actor.driverId,
          shiftId: driverShiftId,
          kind: input.kind,
          s3Key: presign.key,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          uploadStatus: 'pending',
          createdBy: null,
        })
        .returning();
      if (!row) throw new Error('insert job_evidence .. yielded no row');

      const dto = evidenceRowToDto(row);
      return {
        evidence: dto,
        upload: {
          url: presign.url,
          key: presign.key,
          expiresAt: presign.expiresAt,
          ...(presign.requiredHeaders ? { requiredHeaders: presign.requiredHeaders } : {}),
        },
      };
    });
  }

  /**
   * Driver app calls this after the S3 PUT succeeds. Flips the row to
   * `uploaded` and records the post-upload metadata (dimensions /
   * duration / capture coordinates). Idempotent: a second finalize
   * with the same id is a no-op for the status field but still updates
   * the metadata.
   */
  async finalize(
    actor: DriverOrOperatorActor,
    evidenceId: string,
    input: FinalizeEvidencePayload,
  ): Promise<JobEvidenceDto> {
    return this.db.runInTenantContext(this.toTenantCtx(actor), async (tx) => {
      const existing = await tx.query.jobEvidence.findFirst({
        where: and(eq(jobEvidence.id, evidenceId), isNull(jobEvidence.deletedAt)),
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Evidence not found',
        });
      }
      const updates: Record<string, unknown> = {
        uploadStatus: 'uploaded',
        uploadedAt: new Date(),
        updatedAt: new Date(),
      };
      if (input.width !== undefined) updates.widthPx = input.width;
      if (input.height !== undefined) updates.heightPx = input.height;
      if (input.durationSeconds !== undefined)
        updates.durationSeconds = String(input.durationSeconds);
      // capture coordinates are stashed in `notes` until we add proper
      // columns — exposed in a later DB migration. For now, append a
      // small marker so reports can find them.
      if (input.capturedLat !== undefined && input.capturedLng !== undefined) {
        const coord = `[captured@${input.capturedLat},${input.capturedLng}]`;
        updates.notes = existing.notes ? `${existing.notes}\n${coord}` : coord;
      }
      const [row] = await tx
        .update(jobEvidence)
        .set(updates)
        .where(eq(jobEvidence.id, evidenceId))
        .returning();
      if (!row) throw new Error('update job_evidence .. yielded no row');
      return evidenceRowToDto(row);
    });
  }

  async fail(
    actor: DriverOrOperatorActor,
    evidenceId: string,
    input: FailEvidencePayload,
  ): Promise<JobEvidenceDto> {
    return this.db.runInTenantContext(this.toTenantCtx(actor), async (tx) => {
      const existing = await tx.query.jobEvidence.findFirst({
        where: and(eq(jobEvidence.id, evidenceId), isNull(jobEvidence.deletedAt)),
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Evidence not found',
        });
      }
      const [row] = await tx
        .update(jobEvidence)
        .set({
          uploadStatus: 'failed',
          failureReason: input.reason.slice(0, 2000),
          updatedAt: new Date(),
        })
        .where(eq(jobEvidence.id, evidenceId))
        .returning();
      if (!row) throw new Error('update job_evidence .. yielded no row');
      return evidenceRowToDto(row);
    });
  }

  /** Returns all evidence for a job, each row carrying a presigned GET URL. */
  async listForJob(actor: DriverOrOperatorActor, jobId: string): Promise<JobEvidenceWithUrlDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(actor), async (tx) => {
      // Existence check up-front for a clean 404 instead of returning [].
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
        columns: { id: true },
      });
      if (!job) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Job not found',
        });
      }
      const rows = await tx
        .select()
        .from(jobEvidence)
        .where(and(eq(jobEvidence.jobId, jobId), isNull(jobEvidence.deletedAt)))
        .orderBy(desc(jobEvidence.createdAt));
      const out: JobEvidenceWithUrlDto[] = [];
      for (const r of rows) {
        const base = evidenceRowToDto(r);
        if (r.uploadStatus === 'uploaded') {
          try {
            const get = await this.storage.presignGet({
              tenantId: actor.tenantId,
              key: r.s3Key,
            });
            out.push({ ...base, downloadUrl: get.url, downloadUrlExpiresAt: get.expiresAt });
          } catch {
            // Failure to sign should not poison the whole list — surface
            // the row without a URL so the UI can still show it.
            out.push({ ...base, downloadUrl: null, downloadUrlExpiresAt: null });
          }
        } else {
          out.push({ ...base, downloadUrl: null, downloadUrlExpiresAt: null });
        }
      }
      return out;
    });
  }

  private toTenantCtx(actor: DriverOrOperatorActor): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: actor.tenantId,
      userId: actor.actorId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress ?? undefined,
      userAgent: actor.userAgent ?? undefined,
    };
  }
}

async function resolveActiveShiftId(tx: Tx, driverId: string): Promise<string | null> {
  const open = await tx.query.driverShifts.findFirst({
    where: and(
      eq(driverShifts.driverId, driverId),
      isNull(driverShifts.endedAt),
      isNull(driverShifts.deletedAt),
    ),
    columns: { id: true },
  });
  return open?.id ?? null;
}

function evidenceRowToDto(r: typeof jobEvidence.$inferSelect): JobEvidenceDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    jobId: r.jobId,
    driverId: r.driverId,
    shiftId: r.shiftId,
    kind: r.kind,
    s3Key: r.s3Key,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    widthPx: r.widthPx,
    heightPx: r.heightPx,
    durationSeconds: r.durationSeconds === null ? null : Number(r.durationSeconds),
    capturedAt: r.capturedAt ? r.capturedAt.toISOString() : null,
    uploadStatus: r.uploadStatus,
    uploadedAt: r.uploadedAt ? r.uploadedAt.toISOString() : null,
    failureReason: r.failureReason,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}
