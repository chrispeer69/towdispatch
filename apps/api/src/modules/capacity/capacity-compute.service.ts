/**
 * CapacityComputeService — the CADS engine. Event-driven (no polling):
 * callers invoke recompute(tenantId) whenever anything that feeds the
 * ratio changes (shift start/end/break, truck in/out of service, job
 * created / status transition, override or settings change).
 *
 * One recompute:
 *   1. tally eligible drivers + weighted active jobs per duty class
 *      (admin pool with explicit tenant filters — same pattern as
 *      WebhookPublisher; recomputes are system-triggered, not request-scoped)
 *   2. run the pure math (capacity-math.ts) + per-class hysteresis whose
 *      state lives in Redis
 *   3. overlay active manual overrides (they win; the math keeps running)
 *   4. cache the full status DTO in Redis, emit capacity.status_changed to
 *      the tenant socket room
 *   5. persist a capacity_snapshots row per scope on band transition, and
 *      at most every 5 minutes during steady state
 *   6. report which scopes' EFFECTIVE band changed so the broadcast
 *      service can notify partners (post-hysteresis, override-aware)
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  capacityOverrides,
  capacityPartners,
  capacitySettings,
  capacitySnapshots,
  driverShifts,
  jobs,
  tenants,
  trucks,
  users,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  CapacityBand,
  CapacityClassScope,
  CapacityClassStatus,
  CapacityOverrideSummary,
  CapacitySettingsDto,
  CapacityStatusDto,
} from '@ustowdispatch/shared';
import { CAPACITY_DEFAULTS, DISPATCH_EVENTS, defaultCapacitySettings } from '@ustowdispatch/shared';
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { DispatchEventsService } from '../dispatch/dispatch-events.service.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';
import {
  CONCRETE_DUTY_CLASSES,
  type ClassTally,
  type HysteresisState,
  applyHysteresis,
  bandForRatio,
  blendClasses,
  computeClass,
  effectiveBand,
  weightedJobs,
} from './capacity-math.js';

/** Redis keys. status = current DTO; hys = anti-flap state per scope;
 *  pub = last effective bands handed to the broadcast layer. */
const statusKey = (tenantId: string) => `capacity:status:${tenantId}`;
const hysKey = (tenantId: string) => `capacity:hys:${tenantId}`;
const publishedKey = (tenantId: string) => `capacity:pub:${tenantId}`;
/** Cache TTL — long enough to survive quiet nights, refreshed on every recompute. */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

type ScopeState = HysteresisState & { lastPersistAt: string | null };

export interface RecomputeResult {
  status: CapacityStatusDto;
  /** Scopes whose EFFECTIVE (override-aware) band changed this recompute. */
  changedScopes: CapacityClassScope[];
}

@Injectable()
export class CapacityComputeService {
  private readonly log = new Logger(CapacityComputeService.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly events: DispatchEventsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Serve the cached status; recompute lazily when the cache is cold. */
  async getStatus(tenantId: string): Promise<CapacityStatusDto> {
    const cached = await this.redis.get(statusKey(tenantId));
    if (cached) {
      try {
        return JSON.parse(cached) as CapacityStatusDto;
      } catch {
        /* fall through to recompute */
      }
    }
    const { status } = await this.recompute(tenantId, 'cache_miss');
    return status;
  }

  /**
   * Full recompute. `trigger` is log-only breadcrumb. Never throws into the
   * event path — callers that must not fail use recomputeSafe.
   */
  async recompute(tenantId: string, trigger: string): Promise<RecomputeResult> {
    const now = new Date();
    const data = await this.loadInputs(tenantId, now);
    const settings = data.settings;

    // Pure math: per-class tallies -> raw bands.
    const perClass = CONCRETE_DUTY_CLASSES.map((dutyClass) =>
      computeClass(
        data.tallies.find((t) => t.dutyClass === dutyClass) ?? {
          dutyClass,
          eligibleDrivers: 0,
          weightedActiveJobs: 0,
        },
        settings,
      ),
    );
    const blendedTally = blendClasses(perClass);
    const blendedComputed = computeClass(blendedTally, settings);

    // Hysteresis per scope (state survives between recomputes in Redis).
    const hysRaw = await this.redis.get(hysKey(tenantId));
    const hysState: Partial<Record<CapacityClassScope, ScopeState>> = hysRaw
      ? (JSON.parse(hysRaw) as Partial<Record<CapacityClassScope, ScopeState>>)
      : {};

    const scopes: CapacityClassStatus[] = [];
    const persistRows: (typeof capacitySnapshots.$inferInsert)[] = [];
    for (const computed of [...perClass, blendedComputed]) {
      const scope = computed.dutyClass;
      const prev = hysState[scope] ?? null;
      const hys = applyHysteresis(
        prev,
        computed.ratio,
        bandForRatio(computed.ratio, settings),
        settings,
        now,
      );
      const eff = effectiveBand(scope, hys.state.band, data.overrides);
      scopes.push({
        dutyClass: scope,
        band: eff.band,
        ratio: computed.ratio === null ? null : round4(computed.ratio),
        eligibleDrivers: computed.eligibleDrivers,
        weightedActiveJobs: round4(computed.weightedActiveJobs),
        overrideActive: eff.overrideActive,
        computedBand: hys.state.band,
      });

      // Persist on band transition, else at most every 5 minutes.
      const lastPersistAt = prev?.lastPersistAt ? Date.parse(prev.lastPersistAt) : 0;
      const steadyDue =
        now.getTime() - lastPersistAt >= CAPACITY_DEFAULTS.steadyStateSnapshotSeconds * 1000;
      const shouldPersist = hys.transitioned || steadyDue;
      hysState[scope] = {
        ...hys.state,
        lastPersistAt: shouldPersist ? now.toISOString() : (prev?.lastPersistAt ?? null),
      };
      if (shouldPersist) {
        persistRows.push({
          id: uuidv7(),
          tenantId,
          dutyClass: scope,
          band: eff.band,
          ratio: computed.ratio === null ? null : String(round4(computed.ratio)),
          eligibleDrivers: computed.eligibleDrivers,
          weightedActiveJobs: String(round4(computed.weightedActiveJobs)),
          overrideActive: eff.overrideActive,
          computedAt: now,
        });
      }
    }

    const blended = scopes.find((s) => s.dutyClass === 'all');
    if (!blended) throw new Error('recompute: blended scope missing'); // unreachable
    const status: CapacityStatusDto = {
      classes: scopes.filter((s) => s.dutyClass !== 'all'),
      blended,
      guidelineMinutes: settings.guidelineMinutes,
      activeOverrides: data.overrideSummaries,
      lastBroadcastAt: data.lastBroadcastAt,
      computedAt: now.toISOString(),
    };

    // Effective-band change detection (drives partner broadcasts).
    const pubRaw = await this.redis.get(publishedKey(tenantId));
    const published: Partial<Record<CapacityClassScope, CapacityBand>> = pubRaw
      ? (JSON.parse(pubRaw) as Partial<Record<CapacityClassScope, CapacityBand>>)
      : {};
    const changedScopes: CapacityClassScope[] = [];
    for (const s of scopes) {
      if (published[s.dutyClass] !== s.band) changedScopes.push(s.dutyClass);
      published[s.dutyClass] = s.band;
    }

    await this.redis
      .multi()
      .set(statusKey(tenantId), JSON.stringify(status), 'EX', CACHE_TTL_SECONDS)
      .set(hysKey(tenantId), JSON.stringify(hysState), 'EX', CACHE_TTL_SECONDS)
      .set(publishedKey(tenantId), JSON.stringify(published), 'EX', CACHE_TTL_SECONDS)
      .exec();

    if (persistRows.length > 0) {
      await this.admin.runAsAdmin({}, async (db) => {
        await db.insert(capacitySnapshots).values(persistRows);
      });
    }

    this.events.emit(tenantId, DISPATCH_EVENTS.CAPACITY_STATUS_CHANGED, status);
    if (changedScopes.length > 0) {
      this.log.log({
        msg: 'capacity band transition',
        tenantId,
        trigger,
        changedScopes,
        bands: Object.fromEntries(scopes.map((s) => [s.dutyClass, s.band])),
      });
    }
    return { status, changedScopes };
  }

  /** Event-path wrapper: a failed recompute must never break the caller. */
  async recomputeSafe(tenantId: string, trigger: string): Promise<RecomputeResult | null> {
    try {
      return await this.recompute(tenantId, trigger);
    } catch (err) {
      this.log.error({ msg: 'capacity recompute failed', tenantId, trigger, err: String(err) });
      return null;
    }
  }

  /** Tenant settings with defaults when no row exists yet. */
  async loadSettings(tenantId: string): Promise<CapacitySettingsDto> {
    const row = await this.admin.runAsAdmin({}, async (db) =>
      db.query.capacitySettings.findFirst({
        where: and(eq(capacitySettings.tenantId, tenantId), isNull(capacitySettings.deletedAt)),
      }),
    );
    if (!row) return { ...defaultCapacitySettings };
    return {
      availableMaxRatio: Number(row.availableMaxRatio),
      limitedMaxRatio: Number(row.limitedMaxRatio),
      constrainedMaxRatio: Number(row.constrainedMaxRatio),
      jobWeights: row.jobWeights as Record<string, number>,
      hysteresisBuffer: Number(row.hysteresisBuffer),
      hysteresisDwellSeconds: row.hysteresisDwellSeconds,
      minBroadcastIntervalSeconds: row.minBroadcastIntervalSeconds,
      guidelineMinutes: row.guidelineMinutes,
      overrideDefaultExpiryMinutes: row.overrideDefaultExpiryMinutes,
      perYardEnabled: row.perYardEnabled,
    };
  }

  /** Tenant display name for the partner payload. */
  async tenantName(tenantId: string): Promise<string> {
    const row = await this.admin.runAsAdmin({}, async (db) =>
      db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { name: true } }),
    );
    return row?.name ?? tenantId;
  }

  private async loadInputs(tenantId: string, now: Date) {
    const settings = await this.loadSettings(tenantId);
    const activeStatuses = Object.entries(settings.jobWeights)
      .filter(([, w]) => w > 0)
      .map(([status]) => status);

    return this.admin.runAsAdmin({}, async (db) => {
      // Eligible drivers: on an open shift, not on break, on an in-service
      // truck. The driver inherits the truck's duty class.
      const driverRows = await db
        .select({ dutyClass: trucks.dutyClass, drivers: sql<number>`count(*)::int` })
        .from(driverShifts)
        .innerJoin(trucks, eq(driverShifts.truckId, trucks.id))
        .where(
          and(
            eq(driverShifts.tenantId, tenantId),
            isNull(driverShifts.endedAt),
            isNull(driverShifts.deletedAt),
            ne(driverShifts.status, 'break'),
            eq(trucks.tenantId, tenantId),
            eq(trucks.inService, true),
            isNull(trucks.deletedAt),
          ),
        )
        .groupBy(trucks.dutyClass);

      // Weighted active jobs per class.
      const jobRows =
        activeStatuses.length === 0
          ? []
          : await db
              .select({
                dutyClass: jobs.dutyClass,
                status: jobs.status,
                jobCount: sql<number>`count(*)::int`,
              })
              .from(jobs)
              .where(
                and(
                  eq(jobs.tenantId, tenantId),
                  isNull(jobs.deletedAt),
                  inArray(jobs.status, activeStatuses as (typeof jobs.status.enumValues)[number][]),
                ),
              )
              .groupBy(jobs.dutyClass, jobs.status);

      const tallies: ClassTally[] = CONCRETE_DUTY_CLASSES.map((dutyClass) => {
        const statusCounts: Record<string, number> = {};
        for (const r of jobRows) {
          if (r.dutyClass === dutyClass) statusCounts[r.status] = r.jobCount;
        }
        return {
          dutyClass,
          eligibleDrivers: driverRows.find((r) => r.dutyClass === dutyClass)?.drivers ?? 0,
          weightedActiveJobs: weightedJobs(statusCounts, settings.jobWeights),
        };
      });

      // Active overrides + display summaries (creator name for the widget).
      const overrideRows = await db
        .select({
          id: capacityOverrides.id,
          dutyClass: capacityOverrides.dutyClass,
          forcedBand: capacityOverrides.forcedBand,
          reason: capacityOverrides.reason,
          expiresAt: capacityOverrides.expiresAt,
          createdAt: capacityOverrides.createdAt,
          createdByName: users.firstName,
        })
        .from(capacityOverrides)
        .leftJoin(users, eq(capacityOverrides.createdBy, users.id))
        .where(
          and(
            eq(capacityOverrides.tenantId, tenantId),
            isNull(capacityOverrides.deletedAt),
            isNull(capacityOverrides.clearedAt),
            gt(capacityOverrides.expiresAt, now),
          ),
        )
        .orderBy(capacityOverrides.createdAt);

      // Newest override wins per scope (older ones remain visible in history).
      const byScope = new Map<CapacityClassScope, (typeof overrideRows)[number]>();
      for (const o of overrideRows) byScope.set(o.dutyClass, o);
      const overrides = Array.from(byScope.values()).map((o) => ({
        dutyClass: o.dutyClass,
        forcedBand: o.forcedBand,
      }));
      const overrideSummaries: CapacityOverrideSummary[] = Array.from(byScope.values()).map(
        (o) => ({
          id: o.id,
          dutyClass: o.dutyClass,
          forcedBand: o.forcedBand,
          reason: o.reason,
          expiresAt: o.expiresAt.toISOString(),
          createdAt: o.createdAt.toISOString(),
          createdByName: o.createdByName ?? null,
        }),
      );

      const [lastBroadcastRow] = await db
        .select({ last: sql<Date | null>`max(${capacityPartners.lastBroadcastAt})` })
        .from(capacityPartners)
        .where(and(eq(capacityPartners.tenantId, tenantId), isNull(capacityPartners.deletedAt)));
      const lastBroadcastAt = lastBroadcastRow?.last
        ? new Date(lastBroadcastRow.last).toISOString()
        : null;

      return { settings, tallies, overrides, overrideSummaries, lastBroadcastAt };
    });
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
