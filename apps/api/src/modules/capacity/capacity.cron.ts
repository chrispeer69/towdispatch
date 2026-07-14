/**
 * CapacityCron — the two timed sweeps CADS needs on top of its
 * event-driven core (the compute itself never polls):
 *
 *   1. Broadcast retries: due pending capacity_broadcasts rows (backoff
 *      ladder + min-interval-deferred sends) — every minute.
 *   2. Override expiry: an override whose expires_at passed must formally
 *      clear, recompute, and notify partners — every minute. Rows are
 *      stamped clearedAt = expiresAt with clearedBy NULL, which is how
 *      "expired naturally" is distinguishable from "cleared by a person"
 *      in history.
 *
 * Overlap-guarded like WebhookDeliveryCron.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { capacityOverrides } from '@ustowdispatch/db';
import { and, isNull, lte, sql } from 'drizzle-orm';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { CapacityBroadcastWorker } from './capacity-broadcast.worker.js';
import { CapacityEventsListener } from './capacity-events.listener.js';

@Injectable()
export class CapacityCron {
  private readonly log = new Logger(CapacityCron.name);
  private running = false;

  constructor(
    private readonly admin: TransactionRunner,
    private readonly worker: CapacityBroadcastWorker,
    private readonly listener: CapacityEventsListener,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cronTick(): Promise<void> {
    if (this.running) {
      this.log.warn('CapacityCron: previous tick still running, skipping');
      return;
    }
    this.running = true;
    try {
      await this.expireOverrides(new Date());
      await this.worker.sweep(new Date());
    } finally {
      this.running = false;
    }
  }

  /** Clear every lapsed override and recompute the affected tenants. */
  async expireOverrides(now: Date): Promise<number> {
    const expired = await this.admin.runAsAdmin({}, async (db) => {
      return db
        .update(capacityOverrides)
        .set({ clearedAt: sql`${capacityOverrides.expiresAt}`, updatedAt: now })
        .where(
          and(
            isNull(capacityOverrides.clearedAt),
            isNull(capacityOverrides.deletedAt),
            lte(capacityOverrides.expiresAt, now),
          ),
        )
        .returning({ tenantId: capacityOverrides.tenantId });
    });
    const tenantIds = Array.from(new Set(expired.map((r) => r.tenantId)));
    for (const tenantId of tenantIds) {
      await this.listener.run(tenantId, 'override_expired');
    }
    if (tenantIds.length > 0) {
      this.log.log({ msg: 'capacity overrides expired', count: expired.length, tenantIds });
    }
    return expired.length;
  }
}
