/**
 * DeliveryTrackingService — applies provider callback events to the
 * notification_deliveries table.
 *
 * The provider webhooks (Twilio status callback, SendGrid event hook,
 * Mailgun event hook, FCM diagnostic feedback) all post events that
 * reference our delivery row by either the provider's message id or our
 * custom args we pass at send time. We look up the row and flip its
 * status, then roll up the parent notification.
 *
 * Status mapping:
 *   Twilio:    queued/sending → sent, delivered → delivered,
 *              failed/undelivered → failed
 *   SendGrid:  processed/dropped → sent, delivered → delivered,
 *              bounce/dropped → bounced, deferred → (no change)
 *   Mailgun:   accepted → sent, delivered → delivered, failed/permanent → bounced
 *   FCM:       success on send already recorded; failure here means dead token —
 *              we soft-disable the row in notification_device_tokens.
 */
import { Injectable, Logger } from '@nestjs/common';
import { notificationDeliveries, notificationDeviceTokens, notifications } from '@ustowdispatch/db';
import type { NotificationDeliveryStatus } from '@ustowdispatch/shared';
import { and, eq } from 'drizzle-orm';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';

interface ApplyArgs {
  provider: 'twilio' | 'sendgrid' | 'mailgun' | 'fcm';
  /** Either the provider message id OR our delivery id (when custom_args land). */
  deliveryId?: string | undefined;
  providerMessageId?: string | undefined;
  /** Optional — when the provider tells us which token went bad. */
  deviceToken?: string | undefined;
  status: NotificationDeliveryStatus;
  error?: string | undefined;
  /** When the provider includes a tenant id custom_arg (Sendgrid does). */
  tenantId?: string | undefined;
}

@Injectable()
export class DeliveryTrackingService {
  private readonly log = new Logger(DeliveryTrackingService.name);

  constructor(private readonly admin: TransactionRunner) {}

  async apply(args: ApplyArgs): Promise<{ updated: boolean }> {
    return this.admin.runAsAdmin({}, async (tx) => {
      // Resolve the delivery row.
      let where = undefined as ReturnType<typeof eq> | undefined;
      if (args.deliveryId) {
        where = eq(notificationDeliveries.id, args.deliveryId);
      } else if (args.providerMessageId) {
        where = and(
          eq(notificationDeliveries.providerName, args.provider),
          eq(notificationDeliveries.providerMessageId, args.providerMessageId),
        );
      }
      if (!where) return { updated: false };

      const rows = await tx
        .select({
          id: notificationDeliveries.id,
          tenantId: notificationDeliveries.tenantId,
          notificationId: notificationDeliveries.notificationId,
          channel: notificationDeliveries.channel,
          targetAddress: notificationDeliveries.targetAddress,
        })
        .from(notificationDeliveries)
        .where(where)
        .limit(1);
      const row = rows[0];
      if (!row) {
        this.log.debug(
          `delivery-tracking: no delivery match for ${args.provider} ${args.providerMessageId ?? args.deliveryId}`,
        );
        return { updated: false };
      }

      const now = new Date();
      await tx
        .update(notificationDeliveries)
        .set({
          status: args.status,
          lastError: args.error ?? null,
          ...(args.status === 'delivered' ? { deliveredAt: now } : {}),
          ...(args.status === 'failed' || args.status === 'bounced' ? { failedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, row.id));

      // Roll up the parent.
      await this.maybeSettleParent(row.tenantId, row.notificationId);

      // FCM token-killed events: soft-disable the device token row.
      if (
        args.provider === 'fcm' &&
        (args.error?.includes('NotRegistered') ||
          args.error?.includes('UNREGISTERED') ||
          args.error?.includes('not_registered'))
      ) {
        const tokenToDisable = args.deviceToken ?? row.targetAddress;
        if (tokenToDisable) {
          await tx
            .update(notificationDeviceTokens)
            .set({
              active: false,
              revokedAt: now,
              revokedReason: 'provider_unregistered',
              updatedAt: now,
            })
            .where(
              and(
                eq(notificationDeviceTokens.tenantId, row.tenantId),
                eq(notificationDeviceTokens.token, tokenToDisable),
              ),
            );
        }
      }
      return { updated: true };
    });
  }

  private async maybeSettleParent(tenantId: string, notificationId: string): Promise<void> {
    await this.admin.runAsAdmin({}, async (tx) => {
      const rows = await tx
        .select({ status: notificationDeliveries.status })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.notificationId, notificationId));
      if (rows.length === 0) return;
      const terminalSet = new Set([
        'sent',
        'delivered',
        'failed',
        'bounced',
        'suppressed',
        'dead_lettered',
      ]);
      if (!rows.every((r) => terminalSet.has(r.status))) return;
      const success = rows.some((r) => r.status === 'sent' || r.status === 'delivered');
      const failure = rows.some(
        (r) => r.status === 'failed' || r.status === 'bounced' || r.status === 'dead_lettered',
      );
      const status = success && failure ? 'partially_failed' : success ? 'delivered' : 'failed';
      await tx
        .update(notifications)
        .set({ status, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(notifications.id, notificationId));
    });
  }
}
