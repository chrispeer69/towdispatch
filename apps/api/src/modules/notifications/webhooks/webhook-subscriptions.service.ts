/**
 * WebhookSubscriptionsService — admin CRUD for outbound webhook endpoints.
 *
 * Secrets are encrypted at rest via WebhookSecretService and returned
 * plaintext ONLY on the create / rotate paths. The list and detail paths
 * always return secret=null so the admin UI never sees the value after the
 * initial creation. Rotate stamps a fresh secret.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { notificationWebhookDeliveries, uuidv7, webhookSubscriptions } from '@ustowdispatch/db';
import type {
  UpsertWebhookSubscriptionPayload,
  WebhookDeliveryDto,
  WebhookSubscriptionDto,
} from '@ustowdispatch/shared';
import { and, desc, eq } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { WebhookSecretService } from './webhook-secret.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class WebhookSubscriptionsService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly secrets: WebhookSecretService,
  ) {}

  async list(ctx: CallerContext): Promise<WebhookSubscriptionDto[]> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const rows = await tx
          .select()
          .from(webhookSubscriptions)
          .where(eq(webhookSubscriptions.tenantId, ctx.tenantId))
          .orderBy(desc(webhookSubscriptions.createdAt));
        return rows.map((r) => this.toDto(r, null));
      },
    );
  }

  async create(
    ctx: CallerContext,
    body: UpsertWebhookSubscriptionPayload,
  ): Promise<WebhookSubscriptionDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const id = uuidv7();
        const secret = this.secrets.generate();
        const encrypted = this.secrets.encrypt(secret);
        await tx.insert(webhookSubscriptions).values({
          id,
          tenantId: ctx.tenantId,
          name: body.name,
          endpointUrl: body.endpointUrl,
          secret: encrypted,
          eventTypes: body.eventTypes,
          active: body.active ?? true,
        });
        const row = (
          await tx
            .select()
            .from(webhookSubscriptions)
            .where(eq(webhookSubscriptions.id, id))
            .limit(1)
        )[0];
        if (!row) throw new NotFoundException('subscription just created not found');
        return this.toDto(row, secret);
      },
    );
  }

  async update(
    ctx: CallerContext,
    id: string,
    body: UpsertWebhookSubscriptionPayload,
  ): Promise<WebhookSubscriptionDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        await tx
          .update(webhookSubscriptions)
          .set({
            name: body.name,
            endpointUrl: body.endpointUrl,
            eventTypes: body.eventTypes,
            active: body.active ?? true,
            updatedAt: new Date(),
          })
          .where(
            and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.tenantId, ctx.tenantId)),
          );
        const row = (
          await tx
            .select()
            .from(webhookSubscriptions)
            .where(eq(webhookSubscriptions.id, id))
            .limit(1)
        )[0];
        if (!row) throw new NotFoundException('subscription not found');
        return this.toDto(row, null);
      },
    );
  }

  async rotateSecret(ctx: CallerContext, id: string): Promise<WebhookSubscriptionDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const secret = this.secrets.generate();
        const encrypted = this.secrets.encrypt(secret);
        await tx
          .update(webhookSubscriptions)
          .set({ secret: encrypted, updatedAt: new Date() })
          .where(
            and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.tenantId, ctx.tenantId)),
          );
        const row = (
          await tx
            .select()
            .from(webhookSubscriptions)
            .where(eq(webhookSubscriptions.id, id))
            .limit(1)
        )[0];
        if (!row) throw new NotFoundException('subscription not found');
        return this.toDto(row, secret);
      },
    );
  }

  async deleteSubscription(ctx: CallerContext, id: string): Promise<{ ok: boolean }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        await tx
          .delete(webhookSubscriptions)
          .where(
            and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.tenantId, ctx.tenantId)),
          );
        return { ok: true };
      },
    );
  }

  async listDeliveries(
    ctx: CallerContext,
    subscriptionId: string,
    limit = 50,
  ): Promise<WebhookDeliveryDto[]> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const rows = await tx
          .select()
          .from(notificationWebhookDeliveries)
          .where(
            and(
              eq(notificationWebhookDeliveries.tenantId, ctx.tenantId),
              eq(notificationWebhookDeliveries.subscriptionId, subscriptionId),
            ),
          )
          .orderBy(desc(notificationWebhookDeliveries.createdAt))
          .limit(limit);
        return rows.map((r) => ({
          id: r.id,
          subscriptionId: r.subscriptionId,
          eventType: r.eventType,
          status: r.status,
          attemptCount: r.attemptCount,
          responseCode: r.responseCode,
          lastError: r.lastError,
          sentAt: r.sentAt ? r.sentAt.toISOString() : null,
          deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
        }));
      },
    );
  }

  private toDto(
    row: typeof webhookSubscriptions.$inferSelect,
    plaintextSecret: string | null,
  ): WebhookSubscriptionDto {
    return {
      id: row.id,
      name: row.name,
      endpointUrl: row.endpointUrl,
      eventTypes: (row.eventTypes ?? []) as string[],
      active: row.active,
      secret: plaintextSecret,
      lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
      lastFailureAt: row.lastFailureAt ? row.lastFailureAt.toISOString() : null,
      lastFailureReason: row.lastFailureReason,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
