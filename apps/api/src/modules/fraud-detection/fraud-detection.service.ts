/**
 * FraudDetectionService — Fraud Detection on Motor Club Disputes (Session 43).
 *
 * Defensive analytics over existing job / invoice / evidence / payment data:
 *   - scoreJob  : assemble facts → run the pure detectors → persist signals +
 *                 a composite score (re-runnable upsert). ADVISORY ONLY — it
 *                 never blocks invoice submission and never mutates the job /
 *                 invoice / payment tables (those are read-only here).
 *   - disputes  : record + resolve motor-club disputes; record ground-truth
 *                 outcomes that feed a future model-training session.
 *   - queues    : list high/critical-risk jobs, per-job risk detail, the
 *                 dispute log, and per-club dispute stats.
 *
 * Every method runs inside `runInTenantContext` so RLS isolates tenants. All
 * legal/heuristic DECISIONS live in the pure engine fraud-signals.logic.ts;
 * this service is data access + transaction boundaries. Data access is inline
 * (no repository), mirroring the lien-processing + impound modules.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  customers,
  disputeOutcomes,
  disputeRecords,
  fraudRiskScores,
  fraudRiskSignals,
  impoundRecords,
  invoiceLineItems,
  invoices,
  jobEvidence,
  jobFieldPayments,
  jobStatusTransitions,
  jobs,
  uuidv7,
  vehicles,
} from '@ustowdispatch/db';
import type {
  DisputeClubStatDto,
  DisputeOutcomeDto,
  DisputeRecordDto,
  DisputeStatsDto,
  FraudRiskBand,
  FraudRiskScoreDto,
  FraudRiskSignalDto,
  HighRiskListItemDto,
  JobRiskDetailDto,
  JobRiskSummaryDto,
  ListDisputesFilter,
  ListHighRiskFilter,
  RecordDisputePayload,
  RecordOutcomePayload,
  ResolveDisputePayload,
  ReviewFraudScorePayload,
} from '@ustowdispatch/shared';
import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import {
  DEFAULT_OPERATOR_CLOSE_HOUR,
  DEFAULT_OPERATOR_OPEN_HOUR,
  MODEL_VERSION,
} from './fraud-rules.config.js';
import {
  type CompositeScore,
  type GeoPoint,
  type JobFraudFacts,
  computeCompositeScore,
  runAllDetectors,
} from './fraud-signals.logic.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

const DAY_MS = 86_400_000;
const HIGH_RISK_DEFAULT_DAYS = 30;

// Lifecycle order used to detect status reversals (a "back-and-forth" is a
// transition to a lower-ranked status). Terminal failure states sit at the end.
const STATUS_RANK: Record<string, number> = {
  new: 0,
  dispatched: 1,
  enroute: 2,
  on_scene: 3,
  in_progress: 4,
  completed: 5,
  cancelled: 6,
  goa: 6,
};

@Injectable()
export class FraudDetectionService {
  constructor(private readonly db: TenantAwareDb) {}

  // ===================================================================
  // Scoring
  // ===================================================================

  /**
   * Score a single job: assemble facts, run all detectors, persist the signal
   * set (soft-delete the prior set, insert the fresh one) + upsert the score.
   * Used by the controller (manual / pre-submit) and the nightly cron.
   */
  async scoreJob(ctx: CallerCtx, jobId: string): Promise<JobRiskDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const job = await this.requireJob(tx, jobId);
      const facts = await this.buildFacts(tx, job);
      const signals = runAllDetectors(facts);
      const composite = computeCompositeScore(signals);
      await this.persistSignals(tx, ctx, jobId, signals);
      await this.upsertScore(tx, ctx, jobId, composite);
      return this.buildJobRisk(tx, job);
    });
  }

  async getJobRisk(ctx: CallerCtx, jobId: string): Promise<JobRiskDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const job = await this.requireJob(tx, jobId);
      return this.buildJobRisk(tx, job);
    });
  }

  async listHighRisk(ctx: CallerCtx, filter: ListHighRiskFilter): Promise<HighRiskListItemDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const days = filter.days ?? HIGH_RISK_DEFAULT_DAYS;
      const since = new Date(Date.now() - days * DAY_MS);
      const bands: FraudRiskBand[] = filter.band ? [filter.band] : ['high', 'critical'];
      const rows = await tx.query.fraudRiskScores.findMany({
        where: and(
          isNull(fraudRiskScores.deletedAt),
          inArray(fraudRiskScores.riskBand, bands),
          gte(fraudRiskScores.computedAt, since),
        ),
        orderBy: [desc(fraudRiskScores.score0100), desc(fraudRiskScores.computedAt)],
      });
      const out: HighRiskListItemDto[] = [];
      for (const score of rows) {
        const job = await tx.query.jobs.findFirst({
          where: and(eq(jobs.id, score.jobId), isNull(jobs.deletedAt)),
        });
        if (!job) continue;
        out.push({ score: toScoreDto(score), job: await this.buildJobSummary(tx, job) });
      }
      return out;
    });
  }

  async reviewScore(
    ctx: CallerCtx,
    jobId: string,
    input: ReviewFraudScorePayload,
  ): Promise<JobRiskDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const job = await this.requireJob(tx, jobId);
      const [row] = await tx
        .update(fraudRiskScores)
        .set({
          reviewAction: input.reviewAction,
          reviewedAt: new Date(),
          reviewedBy: ctx.userId,
          updatedAt: new Date(),
        })
        .where(and(eq(fraudRiskScores.jobId, jobId), isNull(fraudRiskScores.deletedAt)))
        .returning();
      if (!row) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Job has not been scored yet; score it before recording a review.',
        });
      }
      return this.buildJobRisk(tx, job);
    });
  }

  // ===================================================================
  // Disputes
  // ===================================================================

  async recordDispute(ctx: CallerCtx, input: RecordDisputePayload): Promise<DisputeRecordDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireJob(tx, input.jobId); // tenant-scoped existence check
      const id = uuidv7();
      const [row] = await tx
        .insert(disputeRecords)
        .values({
          id,
          tenantId: ctx.tenantId,
          jobId: input.jobId,
          motorClubName: input.motorClubName,
          disputeType: input.disputeType ?? 'other',
          amountDisputedCents: input.amountDisputedCents ?? 0,
          disputedAt: input.disputedAt ? new Date(input.disputedAt) : new Date(),
          status: 'open',
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('recordDispute: insert returning() yielded no row');
      return toDisputeDto(row);
    });
  }

  async resolveDispute(
    ctx: CallerCtx,
    disputeId: string,
    input: ResolveDisputePayload,
  ): Promise<DisputeRecordDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireDispute(tx, disputeId);
      if (existing.status !== 'open') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: `Dispute is already ${existing.status}.`,
        });
      }
      const [row] = await tx
        .update(disputeRecords)
        .set({
          status: input.status,
          resolutionAt: input.resolutionAt ? new Date(input.resolutionAt) : new Date(),
          resolutionAmountCents: input.resolutionAmountCents ?? null,
          notes: input.notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(and(eq(disputeRecords.id, disputeId), isNull(disputeRecords.deletedAt)))
        .returning();
      if (!row) throw notFound('Dispute not found');
      return toDisputeDto(row);
    });
  }

  async listDisputes(ctx: CallerCtx, filter: ListDisputesFilter): Promise<DisputeRecordDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [isNull(disputeRecords.deletedAt)];
      if (filter.status) clauses.push(eq(disputeRecords.status, filter.status));
      if (filter.motorClubName) {
        clauses.push(eq(disputeRecords.motorClubName, filter.motorClubName));
      }
      if (filter.days) {
        clauses.push(gte(disputeRecords.disputedAt, new Date(Date.now() - filter.days * DAY_MS)));
      }
      const rows = await tx.query.disputeRecords.findMany({
        where: and(...clauses),
        orderBy: [desc(disputeRecords.disputedAt)],
      });
      return rows.map(toDisputeDto);
    });
  }

  async recordOutcome(
    ctx: CallerCtx,
    disputeId: string,
    input: RecordOutcomePayload,
  ): Promise<DisputeOutcomeDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireDispute(tx, disputeId);
      // If a signal is referenced, verify it exists in this tenant (the
      // consistency trigger enforces it too, but a clean 404 is friendlier).
      if (input.signalId) {
        const sig = await tx.query.fraudRiskSignals.findFirst({
          where: eq(fraudRiskSignals.id, input.signalId),
        });
        if (!sig) throw notFound('Referenced signal not found');
      }
      const id = uuidv7();
      const [row] = await tx
        .insert(disputeOutcomes)
        .values({
          id,
          tenantId: ctx.tenantId,
          disputeId,
          signalId: input.signalId ?? null,
          wasFraud: input.wasFraud,
          groundTruthAt: input.groundTruthAt ? new Date(input.groundTruthAt) : new Date(),
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('recordOutcome: insert returning() yielded no row');
      return toOutcomeDto(row);
    });
  }

  // ===================================================================
  // Reports
  // ===================================================================

  /** Per-motor-club dispute aggregate over a lookback window (default 90d). */
  async disputeStats(ctx: CallerCtx, days = 90): Promise<DisputeStatsDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const since = new Date(Date.now() - days * DAY_MS);
      const rows = await tx.query.disputeRecords.findMany({
        where: and(isNull(disputeRecords.deletedAt), gte(disputeRecords.disputedAt, since)),
      });
      const byClub = new Map<string, (typeof rows)[number][]>();
      for (const r of rows) {
        const list = byClub.get(r.motorClubName) ?? [];
        list.push(r);
        byClub.set(r.motorClubName, list);
      }
      const clubs: DisputeClubStatDto[] = [];
      for (const [name, list] of byClub) {
        clubs.push(aggregateClub(name, list));
      }
      clubs.sort((a, b) => b.total - a.total);
      return { generatedAt: new Date().toISOString(), windowDays: days, clubs };
    });
  }

  // ===================================================================
  // Fact assembly
  // ===================================================================

  private async buildFacts(tx: Tx, job: typeof jobs.$inferSelect): Promise<JobFraudFacts> {
    const motorClubName = job.authorizedBy === 'motor_club' ? (job.authorizedByName ?? null) : null;

    // Vehicle / VIN.
    const vehicle = job.vehicleId
      ? await tx.query.vehicles.findFirst({ where: eq(vehicles.id, job.vehicleId) })
      : null;
    const vin = vehicle?.vin ?? null;

    // Sibling jobs: same vehicle + same motor club (the duplicate-billing pair).
    let siblingJobs: { jobId: string; createdAt: Date }[] = [];
    if (job.vehicleId && motorClubName) {
      const sibs = await tx.query.jobs.findMany({
        where: and(
          eq(jobs.vehicleId, job.vehicleId),
          eq(jobs.authorizedByName, motorClubName),
          ne(jobs.id, job.id),
          isNull(jobs.deletedAt),
        ),
        columns: { id: true, createdAt: true },
      });
      siblingJobs = sibs.map((s) => ({ jobId: s.id, createdAt: s.createdAt }));
    }

    // Latest invoice for the job + its line items.
    const invoice = await tx.query.invoices.findFirst({
      where: and(eq(invoices.jobId, job.id), isNull(invoices.deletedAt)),
      orderBy: [desc(invoices.createdAt)],
    });
    let billedMiles: number | null = null;
    let billedStorageDays: number | null = null;
    let afterHoursFlag = false;
    if (invoice) {
      const lines = await tx.query.invoiceLineItems.findMany({
        where: eq(invoiceLineItems.invoiceId, invoice.id),
      });
      let mileSum = 0;
      let storageSum = 0;
      let sawMile = false;
      let sawStorage = false;
      for (const l of lines) {
        if (l.lineType === 'mileage_loaded') {
          mileSum += Number(l.quantity);
          sawMile = true;
        } else if (l.lineType === 'storage_daily') {
          storageSum += Number(l.quantity);
          sawStorage = true;
        } else if (l.lineType === 'after_hours') {
          afterHoursFlag = true;
        }
      }
      billedMiles = sawMile ? mileSum : null;
      billedStorageDays = sawStorage ? storageSum : null;
    }

    const geocodedMiles = job.intowMiles !== null ? Number(job.intowMiles) : null;

    // Status reversals.
    const transitions = await tx.query.jobStatusTransitions.findMany({
      where: eq(jobStatusTransitions.jobId, job.id),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });
    let statusReversalCount = 0;
    for (const t of transitions) {
      const from = STATUS_RANK[t.fromStatus] ?? 0;
      const to = STATUS_RANK[t.toStatus] ?? 0;
      if (to < from) statusReversalCount += 1;
    }

    // Off-hours: UTC hour of dispatch as a v1 approximation (no per-tenant
    // timezone config yet — see SESSION_43_DECISIONS.md).
    const dispatchHourLocal = job.assignedAt ? job.assignedAt.getUTCHours() : null;

    // Evidence photos.
    const evidence = await tx.query.jobEvidence.findMany({
      where: and(eq(jobEvidence.jobId, job.id), isNull(jobEvidence.deletedAt)),
      columns: { kind: true },
    });
    const evidencePhotoCount = evidence.filter((e) => e.kind.startsWith('photo_')).length;

    // Driver volume.
    let driverJobsOnDay: number | null = null;
    let driver30dAvgPerDay: number | null = null;
    if (job.assignedDriverId) {
      const dayStart = startOfUtcDay(job.createdAt);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      driverJobsOnDay = await this.countJobs(
        tx,
        and(
          eq(jobs.assignedDriverId, job.assignedDriverId),
          gte(jobs.createdAt, dayStart),
          sql`${jobs.createdAt} < ${dayEnd.toISOString()}`,
          isNull(jobs.deletedAt),
        ),
      );
      const windowStart = new Date(job.createdAt.getTime() - 30 * DAY_MS);
      const last30 = await this.countJobs(
        tx,
        and(
          eq(jobs.assignedDriverId, job.assignedDriverId),
          gte(jobs.createdAt, windowStart),
          isNull(jobs.deletedAt),
        ),
      );
      driver30dAvgPerDay = last30 / 30;
    }

    // Customer + cash pattern.
    let customerName: string | null = null;
    let customerCashJobCount = 0;
    if (job.customerId) {
      const customer = await tx.query.customers.findFirst({
        where: eq(customers.id, job.customerId),
      });
      customerName = customer?.name ?? null;
      const customerJobs = await tx.query.jobs.findMany({
        where: and(eq(jobs.customerId, job.customerId), isNull(jobs.deletedAt)),
        columns: { id: true },
      });
      const jobIds = customerJobs.map((j) => j.id);
      if (jobIds.length > 0) {
        const cashPays = await tx.query.jobFieldPayments.findMany({
          where: and(
            inArray(jobFieldPayments.jobId, jobIds),
            eq(jobFieldPayments.paymentMethod, 'cash'),
            isNull(jobFieldPayments.deletedAt),
          ),
          columns: { jobId: true },
        });
        customerCashJobCount = new Set(cashPays.map((p) => p.jobId)).size;
      }
    }

    // Geofence: billed drop-off coords; actual coords require telemetry/evidence
    // GPS which is not wired in v1, so actualDropoff is null (detector skips).
    const billedDropoff = parseGeo(job.dropoffLat, job.dropoffLng);
    const actualDropoff: GeoPoint | null = null;

    // Storage: actual gap from a linked impound record, if any.
    let actualStorageDays: number | null = null;
    const impound = await tx.query.impoundRecords.findFirst({
      where: and(eq(impoundRecords.jobId, job.id), isNull(impoundRecords.deletedAt)),
    });
    if (impound) {
      const end = impound.releasedAt ?? new Date();
      actualStorageDays = Math.max(
        0,
        Math.floor((end.getTime() - impound.arrivedAt.getTime()) / DAY_MS),
      );
    }

    return {
      jobId: job.id,
      vin,
      motorClubName,
      jobCreatedAt: job.createdAt,
      siblingJobs,
      billedMiles,
      geocodedMiles,
      statusReversalCount,
      dispatchHourLocal,
      operatorOpenHour: DEFAULT_OPERATOR_OPEN_HOUR,
      operatorCloseHour: DEFAULT_OPERATOR_CLOSE_HOUR,
      afterHoursFlag,
      invoiceTotalCents: invoice?.totalCents ?? null,
      evidencePhotoCount,
      driverJobsOnDay,
      driver30dAvgPerDay,
      customerName,
      customerCashJobCount,
      billedDropoff,
      actualDropoff,
      billedStorageDays,
      actualStorageDays,
    };
  }

  // ===================================================================
  // Persistence
  // ===================================================================

  private async persistSignals(
    tx: Tx,
    ctx: CallerCtx,
    jobId: string,
    signals: ReturnType<typeof runAllDetectors>,
  ): Promise<void> {
    // Soft-delete the prior live set so re-scoring is clean (and the partial
    // unique index on (job_id, signal_type) doesn't fault on the new insert).
    await tx
      .update(fraudRiskSignals)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(fraudRiskSignals.jobId, jobId), isNull(fraudRiskSignals.deletedAt)));
    for (const sig of signals) {
      await tx.insert(fraudRiskSignals).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        jobId,
        signalType: sig.signalType,
        severity: sig.severity,
        confidencePct: sig.confidencePct,
        payload: sig.payload,
        modelVersion: MODEL_VERSION,
      });
    }
  }

  private async upsertScore(
    tx: Tx,
    ctx: CallerCtx,
    jobId: string,
    composite: CompositeScore,
  ): Promise<void> {
    const now = new Date();
    await tx
      .insert(fraudRiskScores)
      .values({
        jobId,
        tenantId: ctx.tenantId,
        score0100: composite.score,
        riskBand: composite.band,
        computedAt: now,
        topSignals: composite.topSignals,
        modelVersion: MODEL_VERSION,
      })
      .onConflictDoUpdate({
        target: fraudRiskScores.jobId,
        set: {
          score0100: composite.score,
          riskBand: composite.band,
          computedAt: now,
          topSignals: composite.topSignals,
          modelVersion: MODEL_VERSION,
          // Re-scoring clears any prior review + the soft-delete flag.
          reviewAction: null,
          reviewedAt: null,
          reviewedBy: null,
          deletedAt: null,
          updatedAt: now,
        },
      });
  }

  // ===================================================================
  // Read builders
  // ===================================================================

  private async buildJobRisk(tx: Tx, job: typeof jobs.$inferSelect): Promise<JobRiskDetailDto> {
    const score = await tx.query.fraudRiskScores.findFirst({
      where: and(eq(fraudRiskScores.jobId, job.id), isNull(fraudRiskScores.deletedAt)),
    });
    const signalRows = await tx.query.fraudRiskSignals.findMany({
      where: and(eq(fraudRiskSignals.jobId, job.id), isNull(fraudRiskSignals.deletedAt)),
      orderBy: [desc(fraudRiskSignals.confidencePct)],
    });
    const disputeRows = await tx.query.disputeRecords.findMany({
      where: and(eq(disputeRecords.jobId, job.id), isNull(disputeRecords.deletedAt)),
      orderBy: [desc(disputeRecords.disputedAt)],
    });
    return {
      job: await this.buildJobSummary(tx, job),
      score: score ? toScoreDto(score) : null,
      signals: signalRows.map(toSignalDto),
      disputes: disputeRows.map(toDisputeDto),
    };
  }

  private async buildJobSummary(tx: Tx, job: typeof jobs.$inferSelect): Promise<JobRiskSummaryDto> {
    const vehicle = job.vehicleId
      ? await tx.query.vehicles.findFirst({ where: eq(vehicles.id, job.vehicleId) })
      : null;
    const customer = job.customerId
      ? await tx.query.customers.findFirst({ where: eq(customers.id, job.customerId) })
      : null;
    const invoice = await tx.query.invoices.findFirst({
      where: and(eq(invoices.jobId, job.id), isNull(invoices.deletedAt)),
      orderBy: [desc(invoices.createdAt)],
    });
    return {
      jobId: job.id,
      jobNumber: job.jobNumber,
      serviceType: job.serviceType,
      status: job.status,
      motorClubName: job.authorizedBy === 'motor_club' ? (job.authorizedByName ?? null) : null,
      customerName: customer?.name ?? null,
      vehicleVin: vehicle?.vin ?? null,
      invoiceTotalCents: invoice?.totalCents ?? null,
      createdAt: job.createdAt.toISOString(),
    };
  }

  // ===================================================================
  // Internals
  // ===================================================================

  private async requireJob(tx: Tx, jobId: string): Promise<typeof jobs.$inferSelect> {
    const row = await tx.query.jobs.findFirst({
      where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
    });
    if (!row) throw notFound('Job not found');
    return row;
  }

  private async requireDispute(
    tx: Tx,
    disputeId: string,
  ): Promise<typeof disputeRecords.$inferSelect> {
    const row = await tx.query.disputeRecords.findFirst({
      where: and(eq(disputeRecords.id, disputeId), isNull(disputeRecords.deletedAt)),
    });
    if (!row) throw notFound('Dispute not found');
    return row;
  }

  private async countJobs(tx: Tx, where: ReturnType<typeof and>): Promise<number> {
    const [r] = await tx.select({ c: sql<number>`count(*)::int` }).from(jobs).where(where);
    return r?.c ?? 0;
  }
}

// ======================================================================
// Pure helpers
// ======================================================================

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseGeo(lat: string | null, lng: string | null): GeoPoint | null {
  if (lat === null || lng === null) return null;
  const a = Number(lat);
  const b = Number(lng);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return { lat: a, lng: b };
}

function aggregateClub(
  name: string,
  list: (typeof disputeRecords.$inferSelect)[],
): DisputeClubStatDto {
  let won = 0;
  let lost = 0;
  let partial = 0;
  let withdrawn = 0;
  let open = 0;
  let amountDisputedCents = 0;
  let recoveredCents = 0;
  let resolutionDaysSum = 0;
  let resolvedWithDate = 0;
  for (const d of list) {
    amountDisputedCents += d.amountDisputedCents;
    if (d.status === 'won') won += 1;
    else if (d.status === 'lost') lost += 1;
    else if (d.status === 'partial') partial += 1;
    else if (d.status === 'withdrawn') withdrawn += 1;
    else open += 1;
    if (d.resolutionAmountCents !== null) recoveredCents += d.resolutionAmountCents;
    if (d.resolutionAt) {
      resolutionDaysSum += (d.resolutionAt.getTime() - d.disputedAt.getTime()) / DAY_MS;
      resolvedWithDate += 1;
    }
  }
  const decided = won + lost + partial; // resolved on the merits (excl. withdrawn)
  const winRatePct = decided > 0 ? Math.round(((won + partial * 0.5) / decided) * 100) : null;
  const avgResolutionDays =
    resolvedWithDate > 0 ? Number((resolutionDaysSum / resolvedWithDate).toFixed(1)) : null;
  return {
    motorClubName: name,
    total: list.length,
    won,
    lost,
    partial,
    withdrawn,
    open,
    winRatePct,
    avgResolutionDays,
    amountDisputedCents,
    recoveredCents,
  };
}

// ----------------------------------------------------------------------
// DTO mappers
// ----------------------------------------------------------------------

function toSignalDto(row: typeof fraudRiskSignals.$inferSelect): FraudRiskSignalDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    signalType: row.signalType,
    severity: row.severity,
    confidencePct: row.confidencePct,
    detectedAt: row.detectedAt.toISOString(),
    payload: row.payload,
    modelVersion: row.modelVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toScoreDto(row: typeof fraudRiskScores.$inferSelect): FraudRiskScoreDto {
  return {
    jobId: row.jobId,
    tenantId: row.tenantId,
    score0100: row.score0100,
    riskBand: row.riskBand,
    computedAt: row.computedAt.toISOString(),
    topSignals: row.topSignals,
    modelVersion: row.modelVersion,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewedBy: row.reviewedBy,
    reviewAction: row.reviewAction,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toDisputeDto(row: typeof disputeRecords.$inferSelect): DisputeRecordDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    motorClubName: row.motorClubName,
    disputeType: row.disputeType,
    disputedAt: row.disputedAt.toISOString(),
    amountDisputedCents: row.amountDisputedCents,
    status: row.status,
    resolutionAt: row.resolutionAt ? row.resolutionAt.toISOString() : null,
    resolutionAmountCents: row.resolutionAmountCents,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toOutcomeDto(row: typeof disputeOutcomes.$inferSelect): DisputeOutcomeDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    disputeId: row.disputeId,
    signalId: row.signalId,
    wasFraud: row.wasFraud,
    groundTruthAt: row.groundTruthAt.toISOString(),
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
