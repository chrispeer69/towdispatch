/**
 * DeadLettersService — list + retry for the admin DLQ inspector.
 *
 * Retry semantics: insert a fresh notifications row (same payload, fresh
 * idempotency key — admin override) and stamp the original dead-letter row
 * with retried_at + retried_by_user_id. The original DLQ row stays around
 * so the admin can audit what fired.
 *
 * Retention: a 30-day sweep cron lives on this service. It runs every hour,
 * deletes notification_dead_letters rows older than the configured window
 * (NOTIFY_DEAD_LETTER_RETENTION_DAYS). We don't delete the parent
 * notifications row — the audit trail is more useful than a few KB saved.
 */
import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  notificationDeadLetters,
  notifications,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type DeadLetterDto,
  type DispatchNotificationResult,
  type NotificationChannel,
} from '@ustowdispatch/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { NotificationsService } from './notifications.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class DeadLettersService implements OnModuleInit {
  private readonly log = new Logger(DeadLettersService.name);
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Hourly sweep. The first run is delayed 5 minutes to avoid hammering
    // the DB at startup.
    this.sweepTimer = setInterval(
      () => {
        this.sweep().catch((err) => this.log.warn(`sweep failed: ${(err as Error).message}`));
      },
      60 * 60 * 1000,
    );
    setTimeout(() => {
      this.sweep().catch(() => {
        /* swallowed */
      });
    }, 5 * 60 * 1000);
  }

  onApplicationShutdown(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  async list(ctx: CallerContext, limit = 50): Promise<DeadLetterDto[]> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const rows = await tx
          .select()
          .from(notificationDeadLetters)
          .where(eq(notificationDeadLetters.tenantId, ctx.tenantId))
          .orderBy(desc(notificationDeadLetters.createdAt))
          .limit(limit);
        return rows.map((r) => ({
          id: r.id,
          notificationId: r.notificationId,
          deliveryId: r.deliveryId,
          channel: r.channel as NotificationChannel,
          failureReason: r.failureReason,
          attemptCount: r.attemptCount,
          retriedAt: r.retriedAt ? r.retriedAt.toISOString() : null,
          payloadSnapshot: (r.payloadSnapshot as Record<string, unknown>) ?? {},
          createdAt: r.createdAt.toISOString(),
        }));
      },
    );
  }

  /**
   * Retry: re-runs dispatch with the original payload. Uses a fresh
   * idempotency key prefixed `dlq-retry:` so it cannot collide with the
   * original idempotency window.
   */
  async retry(ctx: CallerContext, id: string): Promise<DispatchNotificationResult> {
    const dlqRow = await this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const rows = await tx
          .select()
          .from(notificationDeadLetters)
          .where(
            and(
              eq(notificationDeadLetters.tenantId, ctx.tenantId),
              eq(notificationDeadLetters.id, id),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
    );
    if (!dlqRow) throw new NotFoundException('dead-letter not found');

    // Look up the original notification to recover recipient + event type.
    const parent = await this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        if (!dlqRow.notificationId) return null;
        const rows = await tx
          .select()
          .from(notifications)
          .where(eq(notifications.id, dlqRow.notificationId))
          .limit(1);
        return rows[0] ?? null;
      },
    );
    if (!parent) throw new NotFoundException('parent notification missing');

    type DispatchInput = Parameters<NotificationsService['dispatch']>[1];
    const result = await this.notifications.dispatch(ctx, {
      recipient: parent.recipientUserId
        ? { userId: parent.recipientUserId }
        : { roleScope: parent.recipientRoleScope ?? 'role:owner' },
      eventType: parent.eventType as DispatchInput['eventType'],
      templateKey: parent.templateKey,
      payload: (dlqRow.payloadSnapshot as Record<string, unknown>) ?? {},
      channels: [dlqRow.channel as NotificationChannel],
      priority: parent.priority as DispatchInput['priority'],
      idempotencyKey: `dlq-retry:${id}:${uuidv7()}`,
    });

    // Stamp the original DLQ row.
    await this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        await tx
          .update(notificationDeadLetters)
          .set({ retriedAt: new Date(), retriedByUserId: ctx.userId })
          .where(eq(notificationDeadLetters.id, id));
      },
    );
    return result;
  }

  private async sweep(): Promise<void> {
    const days = this.config.notifications.deadLetterRetentionDays;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const deleted = await this.admin.runAsAdmin({}, async (tx) => {
      const rows = await tx
        .delete(notificationDeadLetters)
        .where(lt(notificationDeadLetters.createdAt, cutoff))
        .returning({ id: notificationDeadLetters.id });
      return rows.length;
    });
    if (deleted > 0) {
      this.log.log(`swept ${deleted} dead-letters older than ${days}d`);
    }
  }
}
