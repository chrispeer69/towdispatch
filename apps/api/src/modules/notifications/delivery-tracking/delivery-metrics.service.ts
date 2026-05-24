/**
 * DeliveryMetricsService — aggregate sends/delivers/failures per channel
 * over a rolling N-day window. Surfaces the data the admin dashboard
 * Recharts widgets render.
 */
import { Injectable } from '@nestjs/common';
import { notificationDeadLetters, notificationDeliveries } from '@ustowdispatch/db';
import {
  type DeliveryMetrics,
  NOTIFICATION_CHANNEL_VALUES,
  type NotificationChannel,
} from '@ustowdispatch/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class DeliveryMetricsService {
  constructor(private readonly db: TenantAwareDb) {}

  async forTenant(ctx: CallerContext, windowDays: number): Promise<DeliveryMetrics> {
    const since = new Date(Date.now() - Math.max(1, windowDays) * 24 * 3600 * 1000);
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const rows = await tx
          .select({
            channel: notificationDeliveries.channel,
            status: notificationDeliveries.status,
            c: sql<number>`COUNT(*)::int`,
          })
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.tenantId, ctx.tenantId),
              gte(notificationDeliveries.createdAt, since),
            ),
          )
          .groupBy(notificationDeliveries.channel, notificationDeliveries.status);

        const buckets: DeliveryMetrics['buckets'] = NOTIFICATION_CHANNEL_VALUES.map((channel) => ({
          channel,
          sent: 0,
          delivered: 0,
          failed: 0,
          bounced: 0,
          suppressed: 0,
        }));
        const dl = await tx
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(notificationDeadLetters)
          .where(
            and(
              eq(notificationDeadLetters.tenantId, ctx.tenantId),
              gte(notificationDeadLetters.createdAt, since),
            ),
          );

        for (const r of rows) {
          const bucket = buckets.find((b) => b.channel === (r.channel as NotificationChannel));
          if (!bucket) continue;
          switch (r.status) {
            case 'sent':
              bucket.sent += r.c;
              break;
            case 'delivered':
              bucket.delivered += r.c;
              break;
            case 'failed':
            case 'dead_lettered':
              bucket.failed += r.c;
              break;
            case 'bounced':
              bucket.bounced += r.c;
              break;
            case 'suppressed':
              bucket.suppressed += r.c;
              break;
          }
        }
        const totals = buckets.reduce(
          (acc, b) => ({
            sent: acc.sent + b.sent,
            delivered: acc.delivered + b.delivered,
            failed: acc.failed + b.failed,
            bounced: acc.bounced + b.bounced,
            suppressed: acc.suppressed + b.suppressed,
            deadLettered: acc.deadLettered,
          }),
          { sent: 0, delivered: 0, failed: 0, bounced: 0, suppressed: 0, deadLettered: dl[0]?.c ?? 0 },
        );
        return { windowDays, buckets, totals };
      },
    );
  }
}
