/**
 * SmartDispatchService — AI Smart Dispatch + Predictive ETAs (Session 41).
 *
 * ADVISORY layer over the dispatch (jobs) module. It:
 *   - recommendForJob : scores every eligible (truck, driver) candidate — an
 *                       active driver shift with a truck — on six weighted
 *                       factors, attaches a predicted ETA, and persists the
 *                       ranked top-N to dispatch_recommendations.
 *   - predictEta      : projects drive-to-scene minutes for a job and logs the
 *                       prediction to eta_predictions.
 *   - recordOutcome   : records what the dispatcher actually chose + the
 *                       realised ETA (feedback loop → accuracy reports + the
 *                       per-tenant historical-bias correction).
 *   - reports         : recommendation accuracy / ETA MAE / per-driver ranks.
 *
 * It NEVER assigns a job and NEVER modifies dispatch core (jobs / shifts). All
 * scoring + ETA math lives in the pure engine (scoring/ + eta/); this service
 * is data access + composition. Every tenant query runs inside
 * runInTenantContext so RLS isolates tenants.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  dispatchOutcomes,
  dispatchRecommendations,
  driverShifts,
  drivers,
  etaPredictions,
  evJobAttributes,
  hdDriverCertifications,
  hdJobAttributes,
  jobs,
  trucks,
  uuidv7,
} from '@ustowdispatch/db';
import {
  AI_DISPATCH_MODEL_VERSION,
  DEFAULT_RECOMMENDATION_LIMIT,
  type DispatchOutcomeDto,
  type DispatchRecommendationDto,
  type DriverPerformanceRank,
  type DriverPerformanceReport,
  type EtaAccuracyReport,
  type EtaResultDto,
  type RecommendationAccuracyReport,
  type RecommendationItem,
  type RecordOutcomePayload,
} from '@ustowdispatch/shared';
import { and, eq, gte, isNull, or } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import {
  type EtaPredictInput,
  type EtaProvider,
  HeuristicEtaProvider,
  selectEtaProvider,
} from './eta/index.js';
import { coord } from './scoring/haversine.js';
import { scoreCandidate } from './scoring/score-candidate.js';

export interface DispatchCallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

const MS_PER_HOUR = 3_600_000;
const FATIGUE_WINDOW_HOURS = 24;
const HISTORICAL_WINDOW_DAYS = 30;

@Injectable()
export class SmartDispatchService {
  private readonly log = new Logger(SmartDispatchService.name);
  private readonly etaProvider: EtaProvider;
  private readonly heuristic = new HeuristicEtaProvider();

  constructor(
    private readonly db: TenantAwareDb,
    private readonly config: ConfigService,
  ) {
    const ai = this.config.aiDispatch;
    this.etaProvider = selectEtaProvider({
      providerId: ai.etaProvider,
      mapboxToken: this.config.mapboxAccessToken,
    });
  }

  // ===================================================================
  // Recommendations
  // ===================================================================

  async recommendForJob(
    ctx: DispatchCallerCtx,
    jobId: string,
    limit?: number,
  ): Promise<DispatchRecommendationDto> {
    return this.db.runInTenantContext({ ...ctx }, async (tx) => {
      const job = await this.requireJob(tx, jobId);
      const topN =
        limit ?? this.config.aiDispatch.recommendationLimit ?? DEFAULT_RECOMMENDATION_LIMIT;
      const items = await this.scoreCandidatesForJob(tx, job, topN);

      const id = uuidv7();
      const computedAt = new Date();
      await tx.insert(dispatchRecommendations).values({
        id,
        tenantId: ctx.tenantId,
        jobId,
        computedAt,
        modelVersion: AI_DISPATCH_MODEL_VERSION,
        recommendations: items,
      });

      return {
        id,
        tenantId: ctx.tenantId,
        jobId,
        computedAt: computedAt.toISOString(),
        modelVersion: AI_DISPATCH_MODEL_VERSION,
        recommendations: items,
      };
    });
  }

  /** Latest persisted recommendation set for a job, or null. */
  async getLatestRecommendation(
    ctx: DispatchCallerCtx,
    jobId: string,
  ): Promise<DispatchRecommendationDto | null> {
    return this.db.runInTenantContext({ ...ctx }, async (tx) => {
      await this.requireJob(tx, jobId);
      const row = await this.loadLatestRecommendation(tx, jobId);
      return row ? toRecommendationDto(row) : null;
    });
  }

  // ===================================================================
  // Predictive ETA
  // ===================================================================

  /**
   * Project drive-to-scene minutes for a job. `persist` controls whether the
   * prediction is logged to eta_predictions: GET reads are non-persisting
   * (dispatch board / driver card poll this), an explicit POST persists so the
   * feedback loop has a recorded prediction to measure against.
   */
  async predictEta(ctx: DispatchCallerCtx, jobId: string, persist = false): Promise<EtaResultDto> {
    return this.db.runInTenantContext({ ...ctx }, async (tx) => {
      const job = await this.requireJob(tx, jobId);
      const origin = await this.resolveJobOrigin(tx, job);
      const destLat = coord(job.pickupLat);
      const destLng = coord(job.pickupLng);
      const bias = await this.tenantHistoricalBiasMinutes(tx);

      const now = new Date();
      const input: EtaPredictInput = {
        originLat: origin.lat,
        originLng: origin.lng,
        destLat,
        destLng,
        departureTime: now,
        historicalBiasMinutes: bias,
      };
      const result = this.predictWithFallback(input);
      const modelVersion = this.activeEtaModelVersion(result.predictedMinutes !== null);

      if (persist) {
        await tx.insert(etaPredictions).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          jobId,
          predictedAt: now,
          originLat: origin.lat === null ? null : String(origin.lat),
          originLng: origin.lng === null ? null : String(origin.lng),
          destLat: destLat === null ? null : String(destLat),
          destLng: destLng === null ? null : String(destLng),
          timeOfDay: now.getHours(),
          dayOfWeek: now.getDay(),
          predictedMinutes: result.predictedMinutes ?? 0,
          modelVersion,
        });
      }

      return {
        jobId,
        provider: this.etaProvider.id,
        modelVersion,
        predictedMinutes: result.predictedMinutes,
        breakdown: result.breakdown,
      };
    });
  }

  // ===================================================================
  // Feedback loop
  // ===================================================================

  async recordOutcome(
    ctx: DispatchCallerCtx,
    jobId: string,
    input: RecordOutcomePayload,
  ): Promise<DispatchOutcomeDto> {
    return this.db.runInTenantContext({ ...ctx }, async (tx) => {
      await this.requireJob(tx, jobId);

      // Resolve the recommendation this outcome is measured against: the caller
      // may name one, else use the latest for the job (may be none).
      const rec = input.recommendationId
        ? await this.loadRecommendationById(tx, input.recommendationId)
        : await this.loadLatestRecommendation(tx, jobId);

      let wasTop = false;
      let predictedEta: number | null = null;
      if (rec) {
        const top = rec.recommendations[0];
        wasTop =
          !!top && top.truckId === input.chosenTruckId && top.driverId === input.chosenDriverId;
        const chosen = rec.recommendations.find(
          (r) => r.truckId === input.chosenTruckId && r.driverId === input.chosenDriverId,
        );
        predictedEta = chosen?.predictedEtaMinutes ?? null;
      }

      const actualEta = input.actualEtaMinutes ?? null;
      const etaError =
        actualEta !== null && predictedEta !== null ? actualEta - predictedEta : null;
      const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();

      // One outcome row per job (partial unique on job_id). Upsert by hand so a
      // reassignment / a later actual-ETA fill updates the same row.
      const existing = await tx.query.dispatchOutcomes.findFirst({
        where: and(eq(dispatchOutcomes.jobId, jobId), isNull(dispatchOutcomes.deletedAt)),
      });

      let row: typeof dispatchOutcomes.$inferSelect;
      if (existing) {
        const updated = await tx
          .update(dispatchOutcomes)
          .set({
            recommendationId: rec?.id ?? null,
            chosenTruckId: input.chosenTruckId,
            chosenDriverId: input.chosenDriverId,
            wasTopRecommendation: wasTop,
            predictedEtaMinutes: predictedEta,
            actualEtaMinutes: actualEta,
            etaErrorMinutes: etaError,
            completedAt,
            updatedAt: new Date(),
          })
          .where(eq(dispatchOutcomes.id, existing.id))
          .returning();
        row = updated[0] as typeof dispatchOutcomes.$inferSelect;
      } else {
        const inserted = await tx
          .insert(dispatchOutcomes)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            jobId,
            recommendationId: rec?.id ?? null,
            chosenTruckId: input.chosenTruckId,
            chosenDriverId: input.chosenDriverId,
            wasTopRecommendation: wasTop,
            predictedEtaMinutes: predictedEta,
            actualEtaMinutes: actualEta,
            etaErrorMinutes: etaError,
            completedAt,
          })
          .returning();
        row = inserted[0] as typeof dispatchOutcomes.$inferSelect;
      }

      return toOutcomeDto(row);
    });
  }

  // ===================================================================
  // Reports (served from /ai-dispatch/reports/*, not the reporting module)
  // ===================================================================

  async recommendationAccuracy(
    ctx: DispatchCallerCtx,
    windowDays: number,
  ): Promise<RecommendationAccuracyReport> {
    return this.db.runInTenantContext({ ...ctx }, async (tx) => {
      const rows = await this.loadOutcomesInWindow(tx, windowDays);
      const withRec = rows.filter((r) => r.recommendationId !== null);
      const topOne = withRec.filter((r) => r.wasTopRecommendation).length;
      return {
        windowDays,
        totalOutcomes: rows.length,
        outcomesWithRecommendation: withRec.length,
        topOnePicked: topOne,
        topOneAccuracyPct: withRec.length > 0 ? round1((topOne / withRec.length) * 100) : null,
      };
    });
  }

  async etaAccuracy(ctx: DispatchCallerCtx, windowDays: number): Promise<EtaAccuracyReport> {
    return this.db.runInTenantContext({ ...ctx }, async (tx) => {
      const rows = await this.loadOutcomesInWindow(tx, windowDays);
      const samples = rows.filter((r) => r.etaErrorMinutes !== null);
      if (samples.length === 0) {
        return { windowDays, samples: 0, meanAbsoluteErrorMinutes: null, meanBiasMinutes: null };
      }
      const mae =
        samples.reduce((a, r) => a + Math.abs(r.etaErrorMinutes as number), 0) / samples.length;
      const bias = samples.reduce((a, r) => a + (r.etaErrorMinutes as number), 0) / samples.length;
      return {
        windowDays,
        samples: samples.length,
        meanAbsoluteErrorMinutes: round1(mae),
        meanBiasMinutes: round1(bias),
      };
    });
  }

  async driverPerformance(
    ctx: DispatchCallerCtx,
    windowDays: number,
  ): Promise<DriverPerformanceReport> {
    return this.db.runInTenantContext({ ...ctx }, async (tx) => {
      const rows = await this.loadOutcomesInWindow(tx, windowDays);
      const driverIds = [...new Set(rows.map((r) => r.chosenDriverId))];
      const driverRows = await tx.query.drivers.findMany({
        where: isNull(drivers.deletedAt),
      });
      const nameById = new Map(
        driverRows.map((d) => [d.id, `${d.firstName} ${d.lastName}`.trim()]),
      );

      const agg = new Map<string, { completed: number; errSum: number; errCount: number }>();
      for (const r of rows) {
        const a = agg.get(r.chosenDriverId) ?? { completed: 0, errSum: 0, errCount: 0 };
        a.completed += 1;
        if (r.etaErrorMinutes !== null) {
          a.errSum += Math.abs(r.etaErrorMinutes);
          a.errCount += 1;
        }
        agg.set(r.chosenDriverId, a);
      }

      const unranked = driverIds.map((id) => {
        const a = agg.get(id) as { completed: number; errSum: number; errCount: number };
        const avgErr = a.errCount > 0 ? round1(a.errSum / a.errCount) : null;
        return {
          driverId: id,
          driverName: nameById.get(id) ?? null,
          completedJobs: a.completed,
          avgEtaErrorMinutes: avgErr,
        };
      });

      // Best ETA accuracy first; drivers with no error samples sort last.
      unranked.sort((x, y) => {
        if (x.avgEtaErrorMinutes === null && y.avgEtaErrorMinutes === null) return 0;
        if (x.avgEtaErrorMinutes === null) return 1;
        if (y.avgEtaErrorMinutes === null) return -1;
        return x.avgEtaErrorMinutes - y.avgEtaErrorMinutes;
      });

      const drivers2: DriverPerformanceRank[] = unranked.map((d, i) => ({ ...d, rank: i + 1 }));
      return { windowDays, drivers: drivers2 };
    });
  }

  // ===================================================================
  // Cron entry point (advisory recompute of unassigned jobs)
  // ===================================================================

  /**
   * Recompute recommendations for every unassigned ('new') job in a tenant.
   * Driven by the cron; advisory only. Returns the number of jobs recomputed.
   */
  async recomputeUnassigned(ctx: DispatchCallerCtx): Promise<number> {
    return this.db.runInTenantContext({ ...ctx }, async (tx) => {
      const open = await tx.query.jobs.findMany({
        where: and(eq(jobs.status, 'new'), isNull(jobs.deletedAt)),
        columns: { id: true },
      });
      const topN = this.config.aiDispatch.recommendationLimit ?? DEFAULT_RECOMMENDATION_LIMIT;
      for (const j of open) {
        const job = await this.requireJob(tx, j.id);
        const items = await this.scoreCandidatesForJob(tx, job, topN);
        await tx.insert(dispatchRecommendations).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          jobId: j.id,
          computedAt: new Date(),
          modelVersion: AI_DISPATCH_MODEL_VERSION,
          recommendations: items,
        });
      }
      return open.length;
    });
  }

  /** Distinct tenant ids with at least one unassigned job — drives the cron. */
  async tenantsWithUnassignedJobs(adminTx: Tx): Promise<string[]> {
    const rows = await adminTx
      .select({ tenantId: jobs.tenantId })
      .from(jobs)
      .where(and(eq(jobs.status, 'new'), isNull(jobs.deletedAt)));
    return [...new Set(rows.map((r) => r.tenantId))];
  }

  // ===================================================================
  // Internals — candidate scoring
  // ===================================================================

  private async scoreCandidatesForJob(
    tx: Tx,
    job: typeof jobs.$inferSelect,
    topN: number,
  ): Promise<RecommendationItem[]> {
    const now = new Date();
    const since24h = new Date(now.getTime() - FATIGUE_WINDOW_HOURS * MS_PER_HOUR);
    const weekStart = startOfWeek(now);

    // Job requirements (existence of a live attributes row = the flag).
    const hdJob = await tx.query.hdJobAttributes.findFirst({
      where: and(eq(hdJobAttributes.jobId, job.id), isNull(hdJobAttributes.deletedAt)),
    });
    const evJob = await tx.query.evJobAttributes.findFirst({
      where: and(eq(evJobAttributes.jobId, job.id), isNull(evJobAttributes.deletedAt)),
    });
    const requiresHeavyDuty = !!hdJob;
    const isEv = !!evJob;

    // Fleet snapshot (one read each; scored in memory).
    const shiftRows = await tx.query.driverShifts.findMany({
      where: and(
        isNull(driverShifts.deletedAt),
        or(isNull(driverShifts.endedAt), gte(driverShifts.endedAt, since24h)),
      ),
    });
    const driverRows = await tx.query.drivers.findMany({
      where: and(eq(drivers.active, true), isNull(drivers.deletedAt)),
    });
    const truckRows = await tx.query.trucks.findMany({
      where: and(eq(trucks.inService, true), isNull(trucks.deletedAt)),
    });
    const certRows = await tx.query.hdDriverCertifications.findMany({
      where: isNull(hdDriverCertifications.deletedAt),
    });

    const driverById = new Map(driverRows.map((d) => [d.id, d]));
    const truckById = new Map(truckRows.map((t) => [t.id, t]));
    const certsByDriver = groupBy(
      certRows,
      (c) => c.driverId,
      (c) => c.certType,
    );
    const fatigueByDriver = computeFatigueByDriver(shiftRows, since24h, now);
    const { completedByDriver, tenantAvg } = await this.completionStats(
      tx,
      weekStart,
      driverRows.length,
    );
    const historicalByDriver = await this.historicalErrorByDriver(tx);

    const weights = this.config.aiDispatch.weights;
    const pickupLat = coord(job.pickupLat);
    const pickupLng = coord(job.pickupLng);
    const bias = await this.tenantHistoricalBiasMinutes(tx);

    // Active candidates: an open shift bound to a truck (skip truck-less shifts).
    const candidates = shiftRows.filter((s) => s.endedAt === null && s.truckId !== null);

    const items: RecommendationItem[] = [];
    for (const shift of candidates) {
      const driver = driverById.get(shift.driverId);
      const truck = shift.truckId ? truckById.get(shift.truckId) : undefined;
      if (!driver || !truck) continue; // inactive / out-of-service / soft-deleted

      const truckLat = coord(shift.lastLat);
      const truckLng = coord(shift.lastLng);

      const { score, factors } = scoreCandidate({
        weights,
        distance: { truckLat, truckLng, pickupLat, pickupLng },
        capability: {
          serviceType: job.serviceType,
          requiresHeavyDuty,
          isEv,
          truckEquipment: truck.equipment ?? [],
          heavyDutyCapable: truck.heavyDutyCapable,
        },
        cert: {
          serviceType: job.serviceType,
          requiresHeavyDuty,
          isEv,
          driverCerts: driver.certifications ?? [],
          hdCertTypes: certsByDriver.get(driver.id) ?? [],
          cdlClass: driver.cdlClass,
        },
        fatigueHours: fatigueByDriver.get(driver.id) ?? 0,
        historicalAvgAbsErrorMinutes: historicalByDriver.get(driver.id) ?? null,
        utilization: {
          driverCompletedThisWeek: completedByDriver.get(driver.id) ?? 0,
          tenantAvgCompletedThisWeek: tenantAvg,
        },
      });

      const eta = this.predictWithFallback({
        originLat: truckLat,
        originLng: truckLng,
        destLat: pickupLat,
        destLng: pickupLng,
        departureTime: now,
        historicalBiasMinutes: bias,
      });

      items.push({
        truckId: truck.id,
        truckUnit: truck.unitNumber,
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`.trim(),
        shiftId: shift.id,
        score,
        factors,
        predictedEtaMinutes: eta.predictedMinutes,
      });
    }

    items.sort((a, b) => b.score - a.score);
    return items.slice(0, topN);
  }

  /** Per-driver completed-job count this week + the tenant average. */
  private async completionStats(
    tx: Tx,
    weekStart: Date,
    activeDriverCount: number,
  ): Promise<{ completedByDriver: Map<string, number>; tenantAvg: number }> {
    // Approximate "completed this week" by jobs in `completed` status updated in
    // the window (jobs has no dedicated completed_at column — documented in
    // SESSION_41_DECISIONS.md). Good enough for a load-balance heuristic.
    const rows = await tx.query.jobs.findMany({
      where: and(
        eq(jobs.status, 'completed'),
        gte(jobs.updatedAt, weekStart),
        isNull(jobs.deletedAt),
      ),
      columns: { assignedDriverId: true },
    });
    const completedByDriver = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      if (!r.assignedDriverId) continue;
      completedByDriver.set(
        r.assignedDriverId,
        (completedByDriver.get(r.assignedDriverId) ?? 0) + 1,
      );
      total += 1;
    }
    const tenantAvg = activeDriverCount > 0 ? total / activeDriverCount : 0;
    return { completedByDriver, tenantAvg };
  }

  /** Per-driver mean |ETA error| over the historical window (from outcomes). */
  private async historicalErrorByDriver(tx: Tx): Promise<Map<string, number>> {
    const rows = await this.loadOutcomesInWindow(tx, HISTORICAL_WINDOW_DAYS);
    const agg = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      if (r.etaErrorMinutes === null) continue;
      const a = agg.get(r.chosenDriverId) ?? { sum: 0, n: 0 };
      a.sum += Math.abs(r.etaErrorMinutes);
      a.n += 1;
      agg.set(r.chosenDriverId, a);
    }
    const out = new Map<string, number>();
    for (const [id, a] of agg) out.set(id, a.sum / a.n);
    return out;
  }

  /** Tenant-wide signed mean ETA error → the heuristic bias correction. */
  private async tenantHistoricalBiasMinutes(tx: Tx): Promise<number> {
    const rows = await this.loadOutcomesInWindow(tx, HISTORICAL_WINDOW_DAYS);
    const samples = rows.filter((r) => r.etaErrorMinutes !== null);
    if (samples.length === 0) return 0;
    return samples.reduce((a, r) => a + (r.etaErrorMinutes as number), 0) / samples.length;
  }

  // ===================================================================
  // Internals — loaders / helpers
  // ===================================================================

  private async requireJob(tx: Tx, jobId: string): Promise<typeof jobs.$inferSelect> {
    const row = await tx.query.jobs.findFirst({
      where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
    });
    if (!row) throw notFound('Job not found in this tenant');
    return row;
  }

  /** Origin for a job-level ETA: the assigned driver's active-shift position. */
  private async resolveJobOrigin(
    tx: Tx,
    job: typeof jobs.$inferSelect,
  ): Promise<{ lat: number | null; lng: number | null }> {
    if (!job.assignedDriverId) return { lat: null, lng: null };
    const shift = await tx.query.driverShifts.findFirst({
      where: and(
        eq(driverShifts.driverId, job.assignedDriverId),
        isNull(driverShifts.endedAt),
        isNull(driverShifts.deletedAt),
      ),
    });
    if (!shift) return { lat: null, lng: null };
    return { lat: coord(shift.lastLat), lng: coord(shift.lastLng) };
  }

  private async loadLatestRecommendation(
    tx: Tx,
    jobId: string,
  ): Promise<typeof dispatchRecommendations.$inferSelect | null> {
    const row = await tx.query.dispatchRecommendations.findFirst({
      where: and(
        eq(dispatchRecommendations.jobId, jobId),
        isNull(dispatchRecommendations.deletedAt),
      ),
      orderBy: (t, { desc: d }) => [d(t.computedAt)],
    });
    return row ?? null;
  }

  private async loadRecommendationById(
    tx: Tx,
    id: string,
  ): Promise<typeof dispatchRecommendations.$inferSelect | null> {
    const row = await tx.query.dispatchRecommendations.findFirst({
      where: and(eq(dispatchRecommendations.id, id), isNull(dispatchRecommendations.deletedAt)),
    });
    return row ?? null;
  }

  private async loadOutcomesInWindow(
    tx: Tx,
    windowDays: number,
  ): Promise<(typeof dispatchOutcomes.$inferSelect)[]> {
    const since = new Date(Date.now() - windowDays * 24 * MS_PER_HOUR);
    return tx.query.dispatchOutcomes.findMany({
      where: and(gte(dispatchOutcomes.createdAt, since), isNull(dispatchOutcomes.deletedAt)),
    });
  }

  private predictWithFallback(input: EtaPredictInput): ReturnType<EtaProvider['predict']> {
    try {
      return this.etaProvider.predict(input);
    } catch (err) {
      this.log.warn({
        msg: 'ETA provider failed; falling back to heuristic',
        provider: this.etaProvider.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return this.heuristic.predict(input);
    }
  }

  private activeEtaModelVersion(usedPrimary: boolean): string {
    return usedPrimary ? this.etaProvider.modelVersion : this.heuristic.modelVersion;
  }
}

// ======================================================================
// Pure helpers / mappers
// ======================================================================

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Monday 00:00 (local) of the week containing `now`. */
function startOfWeek(now: Date): Date {
  const d = new Date(now);
  const day = d.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function groupBy<T, V>(rows: T[], keyFn: (r: T) => string, valFn: (r: T) => V): Map<string, V[]> {
  const m = new Map<string, V[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const arr = m.get(k) ?? [];
    arr.push(valFn(r));
    m.set(k, arr);
  }
  return m;
}

/**
 * Hours each driver spent on shift inside the [since, now] window — the overlap
 * of every shift with the window, summed per driver. Drives the fatigue factor.
 */
export function computeFatigueByDriver(
  shifts: { driverId: string; startedAt: Date; endedAt: Date | null }[],
  since: Date,
  now: Date,
): Map<string, number> {
  const out = new Map<string, number>();
  const lo = since.getTime();
  const hi = now.getTime();
  for (const s of shifts) {
    const start = Math.max(lo, s.startedAt.getTime());
    const end = Math.min(hi, (s.endedAt ?? now).getTime());
    const hours = end > start ? (end - start) / MS_PER_HOUR : 0;
    out.set(s.driverId, (out.get(s.driverId) ?? 0) + hours);
  }
  return out;
}

function toRecommendationDto(
  row: typeof dispatchRecommendations.$inferSelect,
): DispatchRecommendationDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    computedAt: row.computedAt.toISOString(),
    modelVersion: row.modelVersion,
    recommendations: row.recommendations as RecommendationItem[],
  };
}

function toOutcomeDto(row: typeof dispatchOutcomes.$inferSelect): DispatchOutcomeDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    recommendationId: row.recommendationId,
    chosenTruckId: row.chosenTruckId,
    chosenDriverId: row.chosenDriverId,
    wasTopRecommendation: row.wasTopRecommendation,
    predictedEtaMinutes: row.predictedEtaMinutes,
    actualEtaMinutes: row.actualEtaMinutes,
    etaErrorMinutes: row.etaErrorMinutes,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
