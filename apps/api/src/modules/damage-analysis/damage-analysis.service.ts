/**
 * DamageAnalysisService — Photo Damage Analysis (Session 42).
 *
 * Orchestrates AI-vision damage runs over evidence photos and the pre/post
 * comparison. Operator-facing reads/writes run inside `runInTenantContext`
 * (RLS). The provider call + finding persistence runs through the admin
 * TransactionRunner as a SYSTEM operation (`processAnalysis`) so the exact
 * same path serves both the inline-first request and the retry worker —
 * the cross-tenant consistency triggers still validate every write.
 *
 * Processing model:
 *   requestAnalysis → insert `queued` row (tenant ctx, RLS validates the
 *   job) → inline `processAnalysis` (awaited; the stub completes instantly).
 *   A transient provider failure leaves the row `queued` with a bumped
 *   retry_count for the worker; the 3rd failure → `failed`. A permanent
 *   failure (bad key, parse) → `failed` immediately.
 *
 * Pure comparison logic lives in compare.logic.ts; this service is data
 * access + transaction boundaries + the provider hand-off.
 */
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type DamageAnalysis,
  type DamageComparison,
  type DamageFinding,
  damageAnalyses,
  damageComparisons,
  damageFindings,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type CompareAnalysesPayload,
  type CompareAnalysisResponse,
  type CompareFindingEntry,
  DEFAULT_DAMAGE_CONFIDENCE_THRESHOLD,
  type DamageAnalysisDetailDto,
  type DamageAnalysisDto,
  type DamageComparisonDto,
  type DamageFindingDto,
  type ListAnalysesQuery,
  type OverrideFindingPayload,
  type RequestAnalysisPayload,
  type StorageProvider,
  type VehicleContext,
  vehicleContextSchema,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { STORAGE_PROVIDER } from '../storage/storage.module.js';
import { type ComparableFinding, compareFindings, summarizeComparison } from './compare.logic.js';
import { DAMAGE_PROVIDER } from './damage-analysis.tokens.js';
import { DamageReportPdfService } from './damage-report-pdf.service.js';
import { type DamagePhoto, type DamageProvider, DamageProviderError } from './provider.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

const MAX_RETRIES = 3;

@Injectable()
export class DamageAnalysisService {
  private readonly log = new Logger(DamageAnalysisService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly pdf: DamageReportPdfService,
    @Inject(DAMAGE_PROVIDER) private readonly provider: DamageProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ===================================================================
  // Reads
  // ===================================================================

  async listAnalyses(ctx: CallerCtx, query: ListAnalysesQuery): Promise<DamageAnalysisDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [eq(damageAnalyses.jobId, query.jobId), isNull(damageAnalyses.deletedAt)];
      if (query.phase) clauses.push(eq(damageAnalyses.phase, query.phase));
      const rows = await tx.query.damageAnalyses.findMany({
        where: and(...clauses),
        orderBy: (t, { desc: d }) => [d(t.requestedAt)],
      });
      return rows.map(toAnalysisDto);
    });
  }

  async getAnalysisDetail(ctx: CallerCtx, analysisId: string): Promise<DamageAnalysisDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.damageAnalyses.findFirst({
        where: and(eq(damageAnalyses.id, analysisId), isNull(damageAnalyses.deletedAt)),
      });
      if (!row) throw notFound('Damage analysis not found');
      const findings = await tx.query.damageFindings.findMany({
        where: and(eq(damageFindings.analysisId, analysisId), isNull(damageFindings.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      });
      return { ...toAnalysisDto(row), findings: findings.map(toFindingDto) };
    });
  }

  // ===================================================================
  // Request + process
  // ===================================================================

  async requestAnalysis(
    ctx: CallerCtx,
    payload: RequestAnalysisPayload,
  ): Promise<DamageAnalysisDetailDto> {
    const analysisId = await this.db.runInTenantContext(ctx, async (tx) => {
      const id = uuidv7();
      // RLS + the cross-tenant trigger validate the job belongs to this tenant.
      const [row] = await tx
        .insert(damageAnalyses)
        .values({
          id,
          tenantId: ctx.tenantId,
          jobId: payload.jobId,
          phase: payload.phase,
          photoKeys: payload.photoKeys,
          vehicleContext: payload.vehicleContext ?? null,
          provider: this.provider.id,
          model: this.provider.model,
          status: 'queued',
          createdBy: ctx.userId,
        })
        .returning({ id: damageAnalyses.id });
      if (!row) throw new Error('requestAnalysis: insert returning() yielded no row');
      return row.id;
    });

    // Inline-first: the stub completes instantly; a live provider runs here
    // too. Transient failures are swallowed (the row stays queued for the
    // worker); the detail reflects whatever state processing reached.
    try {
      await this.processAnalysis(analysisId);
    } catch (err) {
      this.log.warn({
        msg: 'inline damage analysis did not complete; left for worker',
        analysisId,
        err: (err as Error).message,
      });
    }

    return this.getAnalysisDetail(ctx, analysisId);
  }

  /**
   * SYSTEM processor (admin / RLS-bypassing). Idempotent: a `complete` run
   * is a no-op. Used both inline and by the retry worker.
   */
  async processAnalysis(analysisId: string): Promise<void> {
    const analysis = await this.admin.runAsAdmin({}, async (db) =>
      db.query.damageAnalyses.findFirst({
        where: and(eq(damageAnalyses.id, analysisId), isNull(damageAnalyses.deletedAt)),
      }),
    );
    if (!analysis || analysis.status === 'complete') return;

    await this.admin.runAsAdmin({}, async (db) => {
      await db
        .update(damageAnalyses)
        .set({ status: 'processing', updatedAt: new Date() })
        .where(eq(damageAnalyses.id, analysisId));
    });

    try {
      const photos = await this.buildPhotos(analysis);
      const vehicle = this.parseVehicleContext(analysis.vehicleContext);
      const result = await this.provider.analyze(photos, analysis.phase, vehicle);

      await this.admin.runAsAdmin({}, async (db) => {
        // Replace any partial findings from a prior failed attempt, then write.
        await db.delete(damageFindings).where(eq(damageFindings.analysisId, analysisId));
        if (result.findings.length > 0) {
          await db.insert(damageFindings).values(
            result.findings.map((f) => ({
              id: uuidv7(),
              tenantId: analysis.tenantId,
              analysisId,
              area: f.area,
              severity: f.severity,
              confidencePct: f.confidencePct,
              description: f.description ?? null,
              boundingBox: f.boundingBox ?? null,
            })),
          );
        }
        await db
          .update(damageAnalyses)
          .set({
            status: 'complete',
            model: result.model,
            rawResponse: (result.raw ?? null) as object | null,
            error: null,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(damageAnalyses.id, analysisId));
      });
    } catch (err) {
      const transient = err instanceof DamageProviderError && err.transient;
      const message = (err as Error).message.slice(0, 1000);
      const nextRetry = analysis.retryCount + 1;
      // A transient failure with retries left goes back to queued for the
      // worker; otherwise (permanent, or retries exhausted) it fails.
      const failed = !transient || nextRetry >= MAX_RETRIES;
      await this.admin.runAsAdmin({}, async (db) => {
        await db
          .update(damageAnalyses)
          .set({
            status: failed ? 'failed' : 'queued',
            retryCount: transient ? nextRetry : analysis.retryCount,
            error: message,
            updatedAt: new Date(),
          })
          .where(eq(damageAnalyses.id, analysisId));
      });
      throw err;
    }
  }

  private async buildPhotos(analysis: DamageAnalysis): Promise<DamagePhoto[]> {
    const photos: DamagePhoto[] = [];
    for (const key of analysis.photoKeys) {
      const mimeType = guessMime(key);
      let base64: string | undefined;
      if (this.provider.requiresImageBytes) {
        const bytes = await this.storage.get(analysis.tenantId, key);
        base64 = Buffer.from(bytes).toString('base64');
      }
      photos.push({ key, mimeType, ...(base64 ? { base64 } : {}) });
    }
    return photos;
  }

  private parseVehicleContext(raw: unknown): VehicleContext {
    const parsed = vehicleContextSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : {};
  }

  // ===================================================================
  // Operator override (annotate, never delete)
  // ===================================================================

  async overrideFinding(
    ctx: CallerCtx,
    analysisId: string,
    findingId: string,
    payload: OverrideFindingPayload,
  ): Promise<DamageFindingDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const finding = await tx.query.damageFindings.findFirst({
        where: and(eq(damageFindings.id, findingId), isNull(damageFindings.deletedAt)),
      });
      if (!finding || finding.analysisId !== analysisId) throw notFound('Finding not found');
      const patch: Partial<typeof damageFindings.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
        overriddenBy: ctx.userId,
        overriddenAt: new Date(),
      };
      if (payload.operatorSeverity !== undefined) patch.operatorSeverity = payload.operatorSeverity;
      if (payload.operatorNote !== undefined) patch.operatorNote = payload.operatorNote;
      if (payload.isDismissed !== undefined) patch.isDismissed = payload.isDismissed;
      const [row] = await tx
        .update(damageFindings)
        .set(patch)
        .where(eq(damageFindings.id, findingId))
        .returning();
      if (!row) throw notFound('Finding not found');
      return toFindingDto(row);
    });
  }

  // ===================================================================
  // Comparison
  // ===================================================================

  async compareAnalyses(
    ctx: CallerCtx,
    payload: CompareAnalysesPayload,
  ): Promise<CompareAnalysisResponse> {
    const threshold = payload.confidenceThreshold ?? DEFAULT_DAMAGE_CONFIDENCE_THRESHOLD;
    return this.db.runInTenantContext(ctx, async (tx) => {
      const pre = await tx.query.damageAnalyses.findFirst({
        where: and(eq(damageAnalyses.id, payload.preAnalysisId), isNull(damageAnalyses.deletedAt)),
      });
      const post = await tx.query.damageAnalyses.findFirst({
        where: and(eq(damageAnalyses.id, payload.postAnalysisId), isNull(damageAnalyses.deletedAt)),
      });
      if (!pre) throw notFound('Pre-tow analysis not found');
      if (!post) throw notFound('Post-tow analysis not found');
      if (pre.jobId !== post.jobId) {
        throw conflict('INVALID_STATE', 'The two analyses belong to different jobs.');
      }
      if (pre.status !== 'complete' || post.status !== 'complete') {
        throw conflict('INVALID_STATE', 'Both analyses must be complete before comparison.');
      }

      const preFindings = await tx.query.damageFindings.findMany({
        where: and(eq(damageFindings.analysisId, pre.id), isNull(damageFindings.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      });
      const postFindings = await tx.query.damageFindings.findMany({
        where: and(eq(damageFindings.analysisId, post.id), isNull(damageFindings.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      });

      const result = compareFindings(
        preFindings.map(toComparable),
        postFindings.map(toComparable),
        { threshold },
      );
      const summary = summarizeComparison(result, threshold);

      // Upsert the (job, pre, post) comparison (idempotent on the triple).
      const existing = await tx.query.damageComparisons.findFirst({
        where: and(
          eq(damageComparisons.jobId, pre.jobId),
          eq(damageComparisons.preAnalysisId, pre.id),
          eq(damageComparisons.postAnalysisId, post.id),
          isNull(damageComparisons.deletedAt),
        ),
      });
      const now = new Date();
      let row: DamageComparison;
      if (existing) {
        const [updated] = await tx
          .update(damageComparisons)
          .set({
            newDamageFindings: result.newDamage,
            comparisonSummary: summary,
            confidenceThreshold: threshold.toFixed(3),
            generatedAt: now,
            updatedAt: now,
          })
          .where(eq(damageComparisons.id, existing.id))
          .returning();
        if (!updated) throw new Error('compareAnalyses: update yielded no row');
        row = updated;
      } else {
        const [inserted] = await tx
          .insert(damageComparisons)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            jobId: pre.jobId,
            preAnalysisId: pre.id,
            postAnalysisId: post.id,
            newDamageFindings: result.newDamage,
            comparisonSummary: summary,
            confidenceThreshold: threshold.toFixed(3),
            generatedAt: now,
            createdBy: ctx.userId,
          })
          .returning();
        if (!inserted) throw new Error('compareAnalyses: insert yielded no row');
        row = inserted;
      }

      return {
        comparison: toComparisonDto(row),
        result,
        preFindings: preFindings.map(toFindingDto),
        postFindings: postFindings.map(toFindingDto),
      };
    });
  }

  // ===================================================================
  // PDF reports
  // ===================================================================

  async renderAnalysisPdf(
    ctx: CallerCtx,
    analysisId: string,
    language: 'en' | 'es',
  ): Promise<{ bytes: Buffer; filename: string }> {
    const { analysis, findings, vehicle } = await this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.damageAnalyses.findFirst({
        where: and(eq(damageAnalyses.id, analysisId), isNull(damageAnalyses.deletedAt)),
      });
      if (!row) throw notFound('Damage analysis not found');
      const fs = await tx.query.damageFindings.findMany({
        where: and(eq(damageFindings.analysisId, analysisId), isNull(damageFindings.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      });
      return {
        analysis: toAnalysisDto(row),
        findings: fs.map(toFindingDto),
        vehicle: this.parseVehicleContext(row.vehicleContext),
      };
    });
    const bytes = await this.pdf.renderAnalysisReport({
      analysis,
      findings,
      context: {
        jobReference: analysis.jobId,
        vehicleDescription: describeVehicle(vehicle),
        operatorName: ctx.userId,
        language,
      },
    });
    return { bytes, filename: `damage-analysis-${analysisId}.pdf` };
  }

  async renderComparisonPdf(
    ctx: CallerCtx,
    comparisonId: string,
    language: 'en' | 'es',
  ): Promise<{ bytes: Buffer; filename: string }> {
    const { comparison, result, vehicle } = await this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.damageComparisons.findFirst({
        where: and(eq(damageComparisons.id, comparisonId), isNull(damageComparisons.deletedAt)),
      });
      if (!row) throw notFound('Comparison not found');
      const pre = await tx.query.damageFindings.findMany({
        where: and(
          eq(damageFindings.analysisId, row.preAnalysisId),
          isNull(damageFindings.deletedAt),
        ),
      });
      const post = await tx.query.damageFindings.findMany({
        where: and(
          eq(damageFindings.analysisId, row.postAnalysisId),
          isNull(damageFindings.deletedAt),
        ),
      });
      const preAnalysis = await tx.query.damageAnalyses.findFirst({
        where: eq(damageAnalyses.id, row.preAnalysisId),
        columns: { vehicleContext: true },
      });
      // Recompute the full breakdown from the persisted threshold (the row
      // stores only the new-damage delta).
      const threshold = Number(row.confidenceThreshold);
      const res = compareFindings(pre.map(toComparable), post.map(toComparable), { threshold });
      return {
        comparison: toComparisonDto(row),
        result: res,
        vehicle: this.parseVehicleContext(preAnalysis?.vehicleContext ?? null),
      };
    });
    const bytes = await this.pdf.renderComparisonReport({
      comparison,
      result,
      context: {
        jobReference: comparison.jobId,
        vehicleDescription: describeVehicle(vehicle),
        operatorName: ctx.userId,
        language,
      },
    });
    return { bytes, filename: `damage-comparison-${comparisonId}.pdf` };
  }
}

// ======================================================================
// Helpers
// ======================================================================

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function guessMime(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'image/jpeg';
}

function describeVehicle(v: VehicleContext): string {
  const s = [v.year ? String(v.year) : null, v.color, v.make, v.model].filter(Boolean).join(' ');
  return s.length > 0 ? s : 'Vehicle';
}

function toComparable(row: DamageFinding): ComparableFinding {
  return {
    area: row.area,
    severity: row.severity,
    operatorSeverity: row.operatorSeverity,
    confidencePct: row.confidencePct,
    isDismissed: row.isDismissed,
    description: row.description,
    boundingBox: (row.boundingBox as ComparableFinding['boundingBox']) ?? null,
  };
}

function toAnalysisDto(row: DamageAnalysis): DamageAnalysisDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    phase: row.phase,
    photoKeys: row.photoKeys,
    provider: row.provider,
    model: row.model,
    status: row.status,
    error: row.error,
    retryCount: row.retryCount,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toFindingDto(row: DamageFinding): DamageFindingDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    analysisId: row.analysisId,
    area: row.area,
    severity: row.severity,
    confidencePct: row.confidencePct,
    description: row.description,
    boundingBox: (row.boundingBox as DamageFindingDto['boundingBox']) ?? null,
    operatorSeverity: row.operatorSeverity,
    operatorNote: row.operatorNote,
    isDismissed: row.isDismissed,
    overriddenBy: row.overriddenBy,
    overriddenAt: row.overriddenAt ? row.overriddenAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toComparisonDto(row: DamageComparison): DamageComparisonDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    preAnalysisId: row.preAnalysisId,
    postAnalysisId: row.postAnalysisId,
    newDamageFindings: (row.newDamageFindings as CompareFindingEntry[]) ?? [],
    comparisonSummary: row.comparisonSummary,
    confidenceThreshold: Number(row.confidenceThreshold),
    generatedAt: row.generatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
