/**
 * NotificationFeedService — the user-facing in-app feed surface.
 *
 * Lives on top of the notification_deliveries table filtered by
 * channel='in_app' and the caller's user id. The badge count is a
 * COUNT(*) WHERE read_at IS NULL on the same projection.
 */
import { Injectable } from '@nestjs/common';
import {
  notificationDeliveries,
  notifications,
} from '@ustowdispatch/db';
import {
  EVENT_CATEGORY_BY_EVENT,
  type InAppNotificationDto,
  type NotificationChannel,
  type NotificationDeliveryStatus,
  type NotificationEvent,
  type NotificationListQuery,
  type NotificationPriority,
} from '@ustowdispatch/shared';
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class NotificationFeedService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(
    ctx: CallerContext,
    query: NotificationListQuery,
  ): Promise<{ items: InAppNotificationDto[]; total: number; unread: number }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const whereBits = [
          eq(notificationDeliveries.tenantId, ctx.tenantId),
          eq(notificationDeliveries.recipientUserId, ctx.userId),
          eq(notificationDeliveries.channel, query.channel ?? 'in_app'),
        ];
        if (query.status) whereBits.push(eq(notificationDeliveries.status, query.status));
        if (query.unreadOnly) whereBits.push(sql`${notificationDeliveries.readAt} IS NULL`);
        if (query.startDate)
          whereBits.push(gte(notificationDeliveries.createdAt, new Date(query.startDate)));
        if (query.endDate)
          whereBits.push(lte(notificationDeliveries.createdAt, new Date(query.endDate)));

        const rows = await tx
          .select({
            id: notificationDeliveries.id,
            notificationId: notificationDeliveries.notificationId,
            renderedSubject: notificationDeliveries.renderedSubject,
            renderedBody: notificationDeliveries.renderedBody,
            status: notificationDeliveries.status,
            readAt: notificationDeliveries.readAt,
            createdAt: notificationDeliveries.createdAt,
            eventType: notifications.eventType,
            priority: notifications.priority,
            payload: notifications.payload,
          })
          .from(notificationDeliveries)
          .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
          .where(and(...whereBits))
          .orderBy(desc(notificationDeliveries.createdAt))
          .limit(query.limit)
          .offset(query.offset);

        const items: InAppNotificationDto[] = [];
        for (const r of rows) {
          const eventType = r.eventType as NotificationEvent;
          const summaries = await this.summaries(tx, ctx.tenantId, r.notificationId);
          items.push({
            id: r.id,
            notificationId: r.notificationId,
            eventType: r.eventType,
            category: EVENT_CATEGORY_BY_EVENT[eventType] ?? 'system',
            priority: r.priority as NotificationPriority,
            subject: r.renderedSubject,
            body: r.renderedBody ?? '',
            payload: (r.payload as Record<string, unknown>) ?? {},
            status: r.status as NotificationDeliveryStatus,
            readAt: r.readAt ? r.readAt.toISOString() : null,
            createdAt: r.createdAt.toISOString(),
            channelSummaries: summaries,
          });
        }

        const totalRows = await tx
          .select({ c: count() })
          .from(notificationDeliveries)
          .where(and(...whereBits));
        const unreadRows = await tx
          .select({ c: count() })
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.tenantId, ctx.tenantId),
              eq(notificationDeliveries.recipientUserId, ctx.userId),
              eq(notificationDeliveries.channel, 'in_app'),
              sql`${notificationDeliveries.readAt} IS NULL`,
            ),
          );
        return {
          items,
          total: totalRows[0]?.c ?? 0,
          unread: unreadRows[0]?.c ?? 0,
        };
      },
    );
  }

  async markRead(ctx: CallerContext, deliveryId: string): Promise<{ ok: boolean }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        await tx
          .update(notificationDeliveries)
          .set({ readAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(notificationDeliveries.id, deliveryId),
              eq(notificationDeliveries.tenantId, ctx.tenantId),
              eq(notificationDeliveries.recipientUserId, ctx.userId),
              eq(notificationDeliveries.channel, 'in_app'),
            ),
          );
        return { ok: true };
      },
    );
  }

  async markAllRead(ctx: CallerContext): Promise<{ marked: number }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const rows = await tx
          .update(notificationDeliveries)
          .set({ readAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(notificationDeliveries.tenantId, ctx.tenantId),
              eq(notificationDeliveries.recipientUserId, ctx.userId),
              eq(notificationDeliveries.channel, 'in_app'),
              sql`${notificationDeliveries.readAt} IS NULL`,
            ),
          )
          .returning({ id: notificationDeliveries.id });
        return { marked: rows.length };
      },
    );
  }

  private async summaries(
    tx: Tx,
    tenantId: string,
    notificationId: string,
  ): Promise<{ channel: NotificationChannel; status: NotificationDeliveryStatus }[]> {
    const rows = await tx
      .select({
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
      })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.tenantId, tenantId),
          eq(notificationDeliveries.notificationId, notificationId),
        ),
      );
    return rows.map((r) => ({
      channel: r.channel as NotificationChannel,
      status: r.status as NotificationDeliveryStatus,
    }));
  }
}
