/**
 * NotificationsService — the only entry point for outbound notifications.
 *
 * Flow per dispatch:
 *   1. Resolve recipient(s): explicit userId, or expand role-scope to user ids.
 *   2. Idempotency: look up an existing notifications row by
 *      (tenant_id, idempotency_key) inside the dedup window. If present,
 *      short-circuit with `deduplicated=true` and the existing summary.
 *   3. Insert the notifications row (status='pending').
 *   4. For each recipient × channel:
 *      - Resolve preference + quiet hours via PreferencesResolver
 *      - Render the template (tenant override > system default)
 *      - Insert a notification_deliveries row (status='queued' or 'suppressed')
 *   5. For each non-suppressed delivery, enqueue onto the channel's BullMQ queue.
 *   6. Update the parent row: status='dispatched'.
 *
 * Webhook fan-out is handled separately: tenant-level webhook_subscriptions
 * matching the eventType receive a delivery + a queued job.
 *
 * Retries / status transitions / DLQ live in NotificationsQueueService.
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  notificationDeadLetters,
  notificationDeliveries,
  notificationDeviceTokens,
  notifications,
  users,
  uuidv7,
  webhookSubscriptions,
} from '@ustowdispatch/db';
import {
  type DispatchNotificationPayload,
  type DispatchNotificationResult,
  NOTIFICATION_DELIVERY_STATUS_VALUES,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPriority,
} from '@ustowdispatch/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import type { ChannelAdapter } from './channels/channel-adapter.interface.js';
import { CHANNEL_ADAPTERS } from './notifications.tokens.js';
import { PreferencesResolverService } from './preferences/preferences-resolver.service.js';
import { TemplateLoaderService } from './templates/template-loader.service.js';
import { WebhookSecretService } from './webhooks/webhook-secret.service.js';
import {
  NotificationsQueueService,
  type QueueEnqueueRequest,
} from './workers/notifications-queue.service.js';

export interface DispatchContext {
  tenantId: string;
  userId: string;
  requestId: string;
}

interface CompiledDelivery {
  id: string;
  channel: NotificationChannel;
  recipientUserId: string | null;
  targetAddress: string | null;
  renderedSubject: string | null;
  renderedBody: string;
  renderedBodyPlain: string | null;
  status: 'queued' | 'suppressed';
  scheduledFor: Date | null;
  suppressionReason: string | null;
  maxAttempts: number;
  /** Per-delivery payload — for webhook this carries the decrypted secret. */
  effectivePayload: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly preferences: PreferencesResolverService,
    private readonly templates: TemplateLoaderService,
    private readonly queue: NotificationsQueueService,
    private readonly webhookSecrets: WebhookSecretService,
    private readonly config: ConfigService,
    @Inject(CHANNEL_ADAPTERS) private readonly adapters: ChannelAdapter[],
  ) {}

  /**
   * Convenience for adapters/workers that need to look up an adapter by channel.
   */
  adapterFor(channel: NotificationChannel): ChannelAdapter | undefined {
    return this.adapters.find((a) => a.channel === channel);
  }

  /**
   * Main public entry. Idempotent within the 24h dedup window.
   */
  async dispatch(
    ctx: DispatchContext,
    body: DispatchNotificationPayload,
  ): Promise<DispatchNotificationResult> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        // Idempotency check.
        if (body.idempotencyKey) {
          const existing = await tx
            .select({
              id: notifications.id,
              status: notifications.status,
            })
            .from(notifications)
            .where(
              and(
                eq(notifications.tenantId, ctx.tenantId),
                eq(notifications.idempotencyKey, body.idempotencyKey),
              ),
            )
            .limit(1);
          if (existing[0]) {
            // Pull current channel summaries so callers can re-render UI without
            // a second round trip.
            const summaries = await this.loadChannelSummaries(tx, existing[0].id);
            return {
              notificationId: existing[0].id,
              status: existing[0].status,
              deduplicated: true,
              channels: summaries,
            };
          }
        }

        const recipients = await this.resolveRecipients(tx, ctx.tenantId, body);
        if (
          recipients.userIds.length === 0 &&
          body.channels !== 'auto' &&
          !body.channels.includes('webhook')
        ) {
          throw new NotFoundException('recipient resolves to zero users');
        }

        const notificationId = uuidv7();
        const idempotencyExpiresAt = body.idempotencyKey
          ? new Date(Date.now() + 24 * 60 * 60 * 1000)
          : null;

        const templateKey = body.templateKey ?? body.eventType;

        try {
          await tx.insert(notifications).values({
            id: notificationId,
            tenantId: ctx.tenantId,
            recipientUserId: recipients.userIds.length === 1 ? recipients.userIds[0]! : null,
            recipientRoleScope: body.recipient.roleScope ?? null,
            eventType: body.eventType,
            templateKey,
            payload: body.payload,
            priority: body.priority,
            status: 'pending',
            requestedChannels: body.channels === 'auto' ? null : body.channels,
            idempotencyKey: body.idempotencyKey ?? null,
            idempotencyExpiresAt,
          });
        } catch (err) {
          // Race: another caller inserted the same idempotency key between the
          // dedup read and our write. Re-read and return that record.
          if (body.idempotencyKey && this.isUniqueViolation(err)) {
            const reread = await tx
              .select({ id: notifications.id, status: notifications.status })
              .from(notifications)
              .where(
                and(
                  eq(notifications.tenantId, ctx.tenantId),
                  eq(notifications.idempotencyKey, body.idempotencyKey),
                ),
              )
              .limit(1);
            if (reread[0]) {
              const summaries = await this.loadChannelSummaries(tx, reread[0].id);
              return {
                notificationId: reread[0].id,
                status: reread[0].status,
                deduplicated: true,
                channels: summaries,
              };
            }
          }
          throw err;
        }

        // Compile deliveries — one per (recipient, channel) plus webhook
        // subscriptions matched by event type.
        const compiled = await this.compileDeliveries(
          tx,
          ctx.tenantId,
          notificationId,
          recipients,
          body,
        );

        if (compiled.length === 0) {
          // Nothing to fire — mark cancelled and exit.
          await tx
            .update(notifications)
            .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
            .where(eq(notifications.id, notificationId));
          return {
            notificationId,
            status: 'cancelled',
            deduplicated: false,
            channels: [],
          };
        }

        // Persist delivery rows.
        await tx.insert(notificationDeliveries).values(
          compiled.map((d) => ({
            id: d.id,
            tenantId: ctx.tenantId,
            notificationId,
            channel: d.channel,
            recipientUserId: d.recipientUserId,
            targetAddress: d.targetAddress,
            status: d.status,
            attemptCount: 0,
            maxAttempts: d.maxAttempts,
            renderedSubject: d.renderedSubject,
            renderedBody: d.renderedBody,
            scheduledFor: d.scheduledFor,
            lastError: d.suppressionReason,
          })),
        );

        // Flip parent row status.
        const anyToFire = compiled.some((d) => d.status === 'queued');
        await tx
          .update(notifications)
          .set({
            status: anyToFire ? 'dispatched' : 'cancelled',
            dispatchedAt: anyToFire ? new Date() : null,
            completedAt: !anyToFire ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(notifications.id, notificationId));

        // Enqueue every queued delivery. Done outside the txn so a queue
        // failure doesn't roll back the persisted notification record (we
        // prefer "have a row, will retry" over "lost the event entirely").
        const enqueueables: QueueEnqueueRequest[] = compiled
          .filter((d) => d.status === 'queued')
          .map((d) => ({
            channel: d.channel,
            tenantId: ctx.tenantId,
            notificationId,
            deliveryId: d.id,
            priority: body.priority,
            eventType: body.eventType,
            scheduledFor: d.scheduledFor,
            payload: d.effectivePayload,
          }));

        // Queue handle returned outside the tx — the tx commits first.
        setImmediate(() => {
          void this.queue.enqueueMany(enqueueables).catch((err) => {
            this.log.error(`enqueueMany failed: ${(err as Error).message}`);
          });
        });

        return {
          notificationId,
          status: anyToFire ? 'dispatched' : 'cancelled',
          deduplicated: false,
          channels: compiled.map((d) => ({
            channel: d.channel,
            status: d.status,
            suppressionReason: d.suppressionReason,
          })),
        };
      },
    );
  }

  /**
   * Worker callback — called by the per-channel worker AFTER the adapter
   * returned a result. Persists the outcome and decides whether to retry,
   * dead-letter, or settle.
   *
   * Returns whether the worker should re-throw to let BullMQ schedule the
   * retry (true → retry, false → done either way).
   */
  async recordChannelResult(args: {
    tenantId: string;
    notificationId: string;
    deliveryId: string;
    channel: NotificationChannel;
    attempt: number;
    maxAttempts: number;
    result: {
      status: 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced';
      providerMessageId: string | null;
      providerName: string;
      error?: string;
      permanent?: boolean;
    };
  }): Promise<{ shouldRetry: boolean }> {
    const terminal = args.result.status === 'sent' || args.result.status === 'delivered';
    const failed = args.result.status === 'failed' || args.result.status === 'bounced';
    const permanent = !!args.result.permanent;
    const isLastAttempt = args.attempt >= args.maxAttempts;

    return this.admin.runAsAdmin({}, async (tx) => {
      const now = new Date();
      const nextStatus: (typeof NOTIFICATION_DELIVERY_STATUS_VALUES)[number] = terminal
        ? args.result.status === 'delivered'
          ? 'delivered'
          : 'sent'
        : failed && (permanent || isLastAttempt)
          ? 'dead_lettered'
          : 'failed';

      await tx
        .update(notificationDeliveries)
        .set({
          status: nextStatus,
          attemptCount: args.attempt,
          providerMessageId: args.result.providerMessageId,
          providerName: args.result.providerName,
          lastError: args.result.error ?? null,
          ...(terminal ? { sentAt: now } : {}),
          ...(args.result.status === 'delivered' ? { deliveredAt: now } : {}),
          ...(!terminal ? { failedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, args.deliveryId));

      // Roll up parent notification status if every delivery has settled.
      await this.maybeSettleParent(tx, args.tenantId, args.notificationId);

      // If we just dead-lettered, write the DLQ row.
      if (nextStatus === 'dead_lettered') {
        await this.writeDeadLetter(tx, {
          tenantId: args.tenantId,
          notificationId: args.notificationId,
          deliveryId: args.deliveryId,
          channel: args.channel,
          failureReason: args.result.error ?? 'unknown',
          attemptCount: args.attempt,
        });
      }

      return { shouldRetry: failed && !permanent && !isLastAttempt };
    });
  }

  // -----------------------------
  // Webhook subscription helpers
  // -----------------------------

  async getSubscriptionForDelivery(
    tenantId: string,
    subscriptionId: string,
  ): Promise<{
    endpointUrl: string;
    secret: string;
  } | null> {
    return this.admin.runAsAdmin({}, async (tx) => {
      const rows = await tx
        .select({
          endpointUrl: webhookSubscriptions.endpointUrl,
          secret: webhookSubscriptions.secret,
        })
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.tenantId, tenantId),
            eq(webhookSubscriptions.id, subscriptionId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const secret = this.webhookSecrets.decrypt(row.secret);
      return { endpointUrl: row.endpointUrl, secret };
    });
  }

  // -----------------------------
  // Internals
  // -----------------------------

  private async resolveRecipients(
    tx: Tx,
    tenantId: string,
    body: DispatchNotificationPayload,
  ): Promise<{
    userIds: string[];
    targets: Map<string, { email: string | null; phone: string | null; deviceTokens: string[] }>;
  }> {
    const targets = new Map<
      string,
      { email: string | null; phone: string | null; deviceTokens: string[] }
    >();
    if (body.recipient.userId) {
      const userRows = await tx
        .select({
          id: users.id,
          email: users.email,
          phone: users.phone,
        })
        .from(users)
        .where(and(eq(users.id, body.recipient.userId), eq(users.tenantId, tenantId)))
        .limit(1);
      const u = userRows[0];
      if (u) {
        const tokens = await this.loadDeviceTokens(tx, tenantId, [u.id]);
        targets.set(u.id, {
          email: u.email,
          phone: u.phone ?? null,
          deviceTokens: tokens.get(u.id) ?? [],
        });
      }
      return { userIds: u ? [u.id] : [], targets };
    }
    if (body.recipient.roleScope) {
      const ids = await this.preferences.resolveRoleScope(tx, tenantId, body.recipient.roleScope);
      if (ids.length === 0) return { userIds: [], targets };
      const userRows = await tx
        .select({ id: users.id, email: users.email, phone: users.phone })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)));
      const tokens = await this.loadDeviceTokens(
        tx,
        tenantId,
        userRows.map((r) => r.id),
      );
      for (const r of userRows) {
        targets.set(r.id, {
          email: r.email,
          phone: r.phone ?? null,
          deviceTokens: tokens.get(r.id) ?? [],
        });
      }
      return { userIds: userRows.map((r) => r.id), targets };
    }
    return { userIds: [], targets };
  }

  private async loadDeviceTokens(
    tx: Tx,
    tenantId: string,
    userIds: string[],
  ): Promise<Map<string, string[]>> {
    if (userIds.length === 0) return new Map();
    const rows = await tx
      .select({ userId: notificationDeviceTokens.userId, token: notificationDeviceTokens.token })
      .from(notificationDeviceTokens)
      .where(
        and(
          eq(notificationDeviceTokens.tenantId, tenantId),
          eq(notificationDeviceTokens.active, true),
          inArray(notificationDeviceTokens.userId, userIds),
        ),
      );
    const out = new Map<string, string[]>();
    for (const r of rows) {
      const list = out.get(r.userId) ?? [];
      list.push(r.token);
      out.set(r.userId, list);
    }
    return out;
  }

  private async compileDeliveries(
    tx: Tx,
    tenantId: string,
    notificationId: string,
    recipients: {
      userIds: string[];
      targets: Map<string, { email: string | null; phone: string | null; deviceTokens: string[] }>;
    },
    body: DispatchNotificationPayload,
  ): Promise<CompiledDelivery[]> {
    const out: CompiledDelivery[] = [];
    const requested = body.channels;
    const wantsWebhook = requested === 'auto' || requested.includes('webhook');

    // ---- Per-user channels ----
    for (const userId of recipients.userIds) {
      const target = recipients.targets.get(userId);
      if (!target) continue;
      const decisions = await this.preferences.resolveForUser({
        tx,
        tenantId,
        userId,
        eventType: body.eventType as NotificationEvent,
        priority: body.priority,
        requestedChannels:
          requested === 'auto'
            ? 'auto'
            : (requested.filter((c) => c !== 'webhook') as NotificationChannel[]),
      });
      for (const decision of decisions) {
        const channel = decision.channel;
        if (channel === 'webhook') continue;
        // Pick target address per channel.
        let targetAddress: string | null = null;
        if (channel === 'email') targetAddress = target.email;
        else if (channel === 'sms') targetAddress = target.phone;
        else if (channel === 'push') {
          // One delivery per device token.
          for (const token of target.deviceTokens) {
            const rendered = await this.templates.render({
              tenantId,
              templateKey: body.templateKey ?? body.eventType,
              channel,
              payload: body.payload,
            });
            out.push(
              this.buildDelivery({
                userId,
                channel,
                targetAddress: token,
                rendered,
                decision,
                priority: body.priority,
                payload: body.payload,
              }),
            );
          }
          continue;
        } else if (channel === 'in_app') targetAddress = userId;

        const rendered = await this.templates.render({
          tenantId,
          templateKey: body.templateKey ?? body.eventType,
          channel,
          payload: body.payload,
        });
        out.push(
          this.buildDelivery({
            userId,
            channel,
            targetAddress,
            rendered,
            decision,
            priority: body.priority,
            payload: body.payload,
          }),
        );
      }
    }

    // ---- Webhook fan-out ----
    if (wantsWebhook) {
      const subs = await this.matchingWebhookSubscriptions(tx, tenantId, body.eventType);
      for (const sub of subs) {
        const rendered = await this.templates.render({
          tenantId,
          templateKey: body.templateKey ?? body.eventType,
          channel: 'webhook',
          payload: {
            ...body.payload,
            __eventType: body.eventType,
            __notificationId: notificationId,
          },
        });
        // Decrypt the secret so the worker can sign without a second hop.
        const secret = this.webhookSecrets.decrypt(sub.secret);
        out.push({
          id: uuidv7(),
          channel: 'webhook',
          recipientUserId: null,
          targetAddress: sub.endpointUrl,
          renderedSubject: null,
          renderedBody: rendered.body,
          renderedBodyPlain: null,
          status: 'queued',
          scheduledFor: null,
          suppressionReason: null,
          maxAttempts: 5,
          effectivePayload: { ...body.payload, __webhookSecret: secret, __subscriptionId: sub.id },
        });
      }
    }
    return out;
  }

  private buildDelivery(args: {
    userId: string;
    channel: NotificationChannel;
    targetAddress: string | null;
    rendered: { subject: string | null; body: string; bodyPlain: string | null };
    decision: { fire: boolean; suppressionReason: string | null; scheduledFor: Date | null };
    priority: NotificationPriority;
    payload: Record<string, unknown>;
  }): CompiledDelivery {
    // Channel without an address (e.g. user with no phone, push without
    // device tokens) → suppress as 'no_target_address'.
    const hasAddress = !!args.targetAddress;
    const fire = args.decision.fire && hasAddress;
    return {
      id: uuidv7(),
      channel: args.channel,
      recipientUserId: args.userId,
      targetAddress: args.targetAddress,
      renderedSubject: args.rendered.subject,
      renderedBody: args.rendered.body,
      renderedBodyPlain: args.rendered.bodyPlain,
      status: fire ? 'queued' : 'suppressed',
      scheduledFor: args.decision.scheduledFor,
      suppressionReason: fire
        ? null
        : (args.decision.suppressionReason ??
          (hasAddress ? 'preferences_disabled' : 'no_target_address')),
      maxAttempts: maxAttemptsFor(args.channel),
      effectivePayload: args.payload,
    };
  }

  private async matchingWebhookSubscriptions(
    tx: Tx,
    tenantId: string,
    eventType: string,
  ): Promise<{ id: string; endpointUrl: string; secret: string }[]> {
    const rows = await tx
      .select({
        id: webhookSubscriptions.id,
        endpointUrl: webhookSubscriptions.endpointUrl,
        secret: webhookSubscriptions.secret,
        eventTypes: webhookSubscriptions.eventTypes,
      })
      .from(webhookSubscriptions)
      .where(
        and(eq(webhookSubscriptions.tenantId, tenantId), eq(webhookSubscriptions.active, true)),
      );
    return rows
      .filter((r) => {
        const types = r.eventTypes ?? [];
        if (types.includes('*')) return true;
        return types.includes(eventType);
      })
      .map((r) => ({ id: r.id, endpointUrl: r.endpointUrl, secret: r.secret }));
  }

  private async loadChannelSummaries(
    tx: Tx,
    notificationId: string,
  ): Promise<DispatchNotificationResult['channels']> {
    const rows = await tx
      .select({
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        lastError: notificationDeliveries.lastError,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, notificationId));
    return rows.map((r) => ({
      channel: r.channel as NotificationChannel,
      status: r.status,
      suppressionReason: r.status === 'suppressed' ? r.lastError : null,
    }));
  }

  private async maybeSettleParent(tx: Tx, tenantId: string, notificationId: string): Promise<void> {
    // Read all delivery rows for this notification.
    const rows = await tx
      .select({
        status: notificationDeliveries.status,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, notificationId));
    if (rows.length === 0) return;
    const allTerminal = rows.every((r) =>
      ['sent', 'delivered', 'failed', 'bounced', 'suppressed', 'dead_lettered'].includes(r.status),
    );
    if (!allTerminal) return;
    const anySuccess = rows.some((r) => r.status === 'sent' || r.status === 'delivered');
    const anyFailure = rows.some(
      (r) => r.status === 'failed' || r.status === 'bounced' || r.status === 'dead_lettered',
    );
    const status =
      anySuccess && anyFailure ? 'partially_failed' : anySuccess ? 'delivered' : 'failed';
    await tx
      .update(notifications)
      .set({ status, completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.tenantId, tenantId)));
  }

  private async writeDeadLetter(
    tx: Tx,
    args: {
      tenantId: string;
      notificationId: string;
      deliveryId: string;
      channel: NotificationChannel;
      failureReason: string;
      attemptCount: number;
    },
  ): Promise<void> {
    // Snapshot the original payload so the inspector can show what failed.
    const rows = await tx
      .select({ payload: notifications.payload })
      .from(notifications)
      .where(eq(notifications.id, args.notificationId))
      .limit(1);
    const snapshot = rows[0]?.payload ?? {};
    await tx.insert(notificationDeadLetters).values({
      id: uuidv7(),
      tenantId: args.tenantId,
      notificationId: args.notificationId,
      deliveryId: args.deliveryId,
      channel: args.channel,
      payloadSnapshot: snapshot as Record<string, unknown>,
      failureReason: args.failureReason,
      attemptCount: args.attemptCount,
    });
  }

  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
  }
}

function maxAttemptsFor(channel: NotificationChannel): number {
  switch (channel) {
    case 'push':
      return 3;
    case 'sms':
      return 2;
    case 'email':
      return 3;
    case 'webhook':
      return 5;
    case 'in_app':
      return 1;
    default:
      return 3;
  }
}
