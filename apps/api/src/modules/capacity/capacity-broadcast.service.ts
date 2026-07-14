/**
 * CapacityBroadcastService — turns effective band transitions into
 * capacity_broadcasts receipts and hands them to the delivery worker.
 *
 * Anti-flap floor: at most one broadcast per partner per
 * minBroadcastIntervalSeconds. A transition landing inside the window is
 * NOT dropped — it's enqueued with nextRetryAt pushed to the earliest
 * allowed slot, and if that partner already has a pending broadcast the
 * pending row's payload is REPLACED with the newest state (coalescing), so
 * a flap storm produces one delivery carrying the latest truth.
 *
 * Payloads are filtered per partner: a light-duty-only partner sees only
 * the light class; the blended figure always ships.
 */
import { Injectable, Logger } from '@nestjs/common';
import { capacityBroadcasts, capacityPartners, uuidv7 } from '@ustowdispatch/db';
import type {
  CapacityPayload,
  CapacityStatusDto,
  CapacityTestFireResult,
} from '@ustowdispatch/shared';
import { CAPACITY_SCHEMA_VERSION } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { CapacityBroadcastWorker } from './capacity-broadcast.worker.js';
import { CapacityComputeService } from './capacity-compute.service.js';

@Injectable()
export class CapacityBroadcastService {
  private readonly log = new Logger(CapacityBroadcastService.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly compute: CapacityComputeService,
    private readonly worker: CapacityBroadcastWorker,
  ) {}

  /**
   * Fan a fresh status out to every enabled webhook partner. Called after
   * any recompute whose effective bands changed.
   */
  async onCapacityChanged(tenantId: string, status: CapacityStatusDto): Promise<void> {
    const now = new Date();
    const settings = await this.compute.loadSettings(tenantId);
    const tenantName = await this.compute.tenantName(tenantId);

    const enqueuedIds = await this.admin.runAsAdmin({}, async (db) => {
      const partnerRows = await db.query.capacityPartners.findMany({
        where: and(
          eq(capacityPartners.tenantId, tenantId),
          eq(capacityPartners.enabled, true),
          eq(capacityPartners.deliveryMode, 'webhook'),
          isNull(capacityPartners.deletedAt),
        ),
      });
      const ids: string[] = [];
      for (const partner of partnerRows) {
        const payload = buildCapacityPayload(tenantId, tenantName, status, partner.classVisibility);

        // Coalesce: replace any still-pending broadcast for this partner.
        const [pending] = await db
          .update(capacityBroadcasts)
          .set({ payload, updatedAt: now })
          .where(
            and(
              eq(capacityBroadcasts.tenantId, tenantId),
              eq(capacityBroadcasts.partnerId, partner.id),
              eq(capacityBroadcasts.status, 'pending'),
              isNull(capacityBroadcasts.deletedAt),
            ),
          )
          .returning({ id: capacityBroadcasts.id });
        if (pending) continue;

        // Min-interval floor: schedule inside the window, deliver now otherwise.
        const earliest = partner.lastBroadcastAt
          ? new Date(
              partner.lastBroadcastAt.getTime() + settings.minBroadcastIntervalSeconds * 1000,
            )
          : now;
        const id = uuidv7();
        await db.insert(capacityBroadcasts).values({
          id,
          tenantId,
          partnerId: partner.id,
          payload,
          status: 'pending',
          retryCount: 0,
          nextRetryAt: earliest > now ? earliest : now,
        });
        if (earliest <= now) ids.push(id);
      }
      return ids;
    });

    // Deliver due rows outside the transaction; delayed rows are picked up
    // by the retry cron sweep.
    for (const id of enqueuedIds) {
      setImmediate(() => {
        this.worker.attempt(id).catch((err) => {
          this.log.error({ msg: 'broadcast attempt threw', broadcastId: id, err: String(err) });
        });
      });
    }
  }

  /** Settings-page "send test webhook" — one synchronous delivery. */
  async testFire(tenantId: string, partnerId: string): Promise<CapacityTestFireResult> {
    const status = await this.compute.getStatus(tenantId);
    const tenantName = await this.compute.tenantName(tenantId);
    const now = new Date();

    const broadcastId = await this.admin.runAsAdmin({}, async (db) => {
      const partner = await db.query.capacityPartners.findFirst({
        where: and(
          eq(capacityPartners.id, partnerId),
          eq(capacityPartners.tenantId, tenantId),
          isNull(capacityPartners.deletedAt),
        ),
      });
      if (!partner) return null;
      const id = uuidv7();
      await db.insert(capacityBroadcasts).values({
        id,
        tenantId,
        partnerId,
        payload: buildCapacityPayload(tenantId, tenantName, status, partner.classVisibility),
        status: 'pending',
        retryCount: 0,
        nextRetryAt: now,
      });
      return id;
    });
    if (!broadcastId) {
      return {
        broadcastId: NIL_UUID,
        delivered: false,
        httpStatus: null,
        latencyMs: null,
        error: 'partner not found',
      };
    }

    // Single-shot: exhaust immediately on failure instead of retrying.
    const outcome = await this.worker.attempt(broadcastId, { singleShot: true });
    return {
      broadcastId,
      delivered: outcome.delivered,
      httpStatus: outcome.httpStatus,
      latencyMs: outcome.latencyMs,
      error: outcome.error,
    };
  }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Shape the partner-facing snake_case payload, scoped to class visibility. */
export function buildCapacityPayload(
  tenantId: string,
  tenantName: string,
  status: CapacityStatusDto,
  classVisibility: string[],
): CapacityPayload {
  const visible = new Set(classVisibility);
  const classes: Record<string, CapacityPayload['blended']> = {};
  let overrideActive = status.blended.overrideActive;
  for (const c of status.classes) {
    if (!visible.has(c.dutyClass)) continue;
    classes[c.dutyClass] = {
      status: c.band,
      ratio: c.ratio,
      drivers: c.eligibleDrivers,
      active_jobs: c.weightedActiveJobs,
    };
    if (c.overrideActive) overrideActive = true;
  }
  return {
    schema_version: CAPACITY_SCHEMA_VERSION,
    tenant_id: tenantId,
    tenant_name: tenantName,
    timestamp: status.computedAt,
    guideline_minutes: status.guidelineMinutes,
    override_active: overrideActive,
    classes,
    blended: {
      status: status.blended.band,
      ratio: status.blended.ratio,
      drivers: status.blended.eligibleDrivers,
      active_jobs: status.blended.weightedActiveJobs,
    },
  };
}
