/**
 * WebhooksService — operator-facing CRUD for webhook endpoints + the delivery
 * log + manual test-send / retry. Session-auth'd, tenant-isolated.
 *
 * The signing secret is returned exactly once, from createEndpoint(); it is
 * AES-GCM-encrypted at rest and never re-surfaced. test-send and retry verify
 * tenant ownership under RLS, then hand off to the (admin) delivery worker.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7, webhookDeliveries, webhookEndpoints } from '@ustowdispatch/db';
import {
  type CreateWebhookEndpointPayload,
  type CreateWebhookEndpointResult,
  ERROR_CODES,
  type PublicApiWebhookDeliveryDto,
  type PublicWebhookDeliveryDto,
  type UpdateWebhookEndpointPayload,
  type WebhookEndpointDto,
  type WebhookEventType,
} from '@ustowdispatch/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { WebhookSecretCipher } from '../crypto/webhook-secret-cipher.service.js';
import { WebhookDeliveryWorker } from '../webhooks/webhook-delivery.worker.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

const DELIVERY_LOG_LIMIT = 100;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly cipher: WebhookSecretCipher,
    private readonly worker: WebhookDeliveryWorker,
  ) {}

  async listEndpoints(ctx: CallerCtx): Promise<WebhookEndpointDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.webhookEndpoints.findMany({
        where: isNull(webhookEndpoints.deletedAt),
        orderBy: (t, { desc: d }) => [d(t.createdAt)],
      });
      return rows.map(toEndpointDto);
    });
  }

  async createEndpoint(
    ctx: CallerCtx,
    input: CreateWebhookEndpointPayload,
  ): Promise<CreateWebhookEndpointResult> {
    const signingSecret = this.cipher.generateSecret();
    const row = await this.db.runInTenantContext(ctx, async (tx) => {
      const [r] = await tx
        .insert(webhookEndpoints)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          url: input.url,
          description: input.description ?? null,
          secretEncrypted: this.cipher.encrypt(signingSecret),
          events: input.events,
          createdBy: ctx.userId,
        })
        .returning();
      if (!r) throw new Error('createEndpoint: insert returning() yielded no row');
      return r;
    });
    return { endpoint: toEndpointDto(row), signingSecret };
  }

  async updateEndpoint(
    ctx: CallerCtx,
    id: string,
    input: UpdateWebhookEndpointPayload,
  ): Promise<WebhookEndpointDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.webhookEndpoints.findFirst({
        where: and(eq(webhookEndpoints.id, id), isNull(webhookEndpoints.deletedAt)),
      });
      if (!existing) throw notFound();
      const patch: Partial<typeof webhookEndpoints.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.url !== undefined) patch.url = input.url;
      if (input.description !== undefined) patch.description = input.description ?? null;
      if (input.events !== undefined) patch.events = input.events;
      if (input.active !== undefined) patch.active = input.active;
      const [row] = await tx
        .update(webhookEndpoints)
        .set(patch)
        .where(eq(webhookEndpoints.id, id))
        .returning();
      if (!row) throw notFound();
      return toEndpointDto(row);
    });
  }

  async deleteEndpoint(ctx: CallerCtx, id: string): Promise<void> {
    const ok = await this.db.runInTenantContext(ctx, async (tx) => {
      const [row] = await tx
        .update(webhookEndpoints)
        .set({ deletedAt: new Date(), updatedAt: new Date(), active: false })
        .where(and(eq(webhookEndpoints.id, id), isNull(webhookEndpoints.deletedAt)))
        .returning({ id: webhookEndpoints.id });
      return Boolean(row);
    });
    if (!ok) throw notFound();
  }

  async listDeliveries(ctx: CallerCtx, endpointId: string): Promise<PublicApiWebhookDeliveryDto[]> {
  async listDeliveries(ctx: CallerCtx, endpointId: string): Promise<PublicWebhookDeliveryDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      // Confirm the endpoint is ours (RLS already enforces, 404 is friendlier).
      const endpoint = await tx.query.webhookEndpoints.findFirst({
        where: and(eq(webhookEndpoints.id, endpointId), isNull(webhookEndpoints.deletedAt)),
        columns: { id: true },
      });
      if (!endpoint) throw notFound();
      const rows = await tx.query.webhookDeliveries.findMany({
        where: and(
          eq(webhookDeliveries.endpointId, endpointId),
          isNull(webhookDeliveries.deletedAt),
        ),
        orderBy: [desc(webhookDeliveries.createdAt)],
        limit: DELIVERY_LOG_LIMIT,
      });
      return rows.map(toDeliveryDto);
    });
  }

  /** Enqueue + immediately attempt a synthetic ping delivery to the endpoint. */
  async testSend(ctx: CallerCtx, endpointId: string): Promise<PublicApiWebhookDeliveryDto> {
  async testSend(ctx: CallerCtx, endpointId: string): Promise<PublicWebhookDeliveryDto> {
    const deliveryId = await this.db.runInTenantContext(ctx, async (tx) => {
      const endpoint = await tx.query.webhookEndpoints.findFirst({
        where: and(eq(webhookEndpoints.id, endpointId), isNull(webhookEndpoints.deletedAt)),
      });
      if (!endpoint) throw notFound();
      const id = uuidv7();
      const now = new Date();
      const eventType = (endpoint.events[0] ?? 'job.created') as WebhookEventType;
      await tx.insert(webhookDeliveries).values({
        id,
        tenantId: ctx.tenantId,
        endpointId,
        eventType,
        eventId: null,
        payload: {
          id,
          type: eventType,
          createdAt: now.toISOString(),
          data: { test: true, message: 'Test delivery from US Tow DISPATCH' },
        },
        status: 'pending',
        attempt: 0,
        nextRetryAt: now,
      });
      return id;
    });
    await this.worker.retryNow(deliveryId);
    return this.getDelivery(ctx, deliveryId);
  }

  async retryDelivery(ctx: CallerCtx, deliveryId: string): Promise<PublicApiWebhookDeliveryDto> {
  async retryDelivery(ctx: CallerCtx, deliveryId: string): Promise<PublicWebhookDeliveryDto> {
    await this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.webhookDeliveries.findFirst({
        where: and(eq(webhookDeliveries.id, deliveryId), isNull(webhookDeliveries.deletedAt)),
        columns: { id: true },
      });
      if (!row) throw notFound();
    });
    await this.worker.retryNow(deliveryId);
    return this.getDelivery(ctx, deliveryId);
  }

  private async getDelivery(
    ctx: CallerCtx,
    deliveryId: string,
  ): Promise<PublicApiWebhookDeliveryDto> {
  private async getDelivery(ctx: CallerCtx, deliveryId: string): Promise<PublicWebhookDeliveryDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.webhookDeliveries.findFirst({
        where: and(eq(webhookDeliveries.id, deliveryId), isNull(webhookDeliveries.deletedAt)),
      });
      if (!row) throw notFound();
      return toDeliveryDto(row);
    });
  }
}

function toEndpointDto(row: typeof webhookEndpoints.$inferSelect): WebhookEndpointDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    url: row.url,
    description: row.description,
    events: row.events as WebhookEventType[],
    active: row.active,
    createdBy: row.createdBy,
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
    lastFailureAt: row.lastFailureAt ? row.lastFailureAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDeliveryDto(row: typeof webhookDeliveries.$inferSelect): PublicApiWebhookDeliveryDto {
function toDeliveryDto(row: typeof webhookDeliveries.$inferSelect): PublicWebhookDeliveryDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    endpointId: row.endpointId,
    eventType: row.eventType,
    eventId: row.eventId,
    payload: row.payload,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    nextRetryAt: row.nextRetryAt ? row.nextRetryAt.toISOString() : null,
    responseCode: row.responseCode,
    responseBody: row.responseBody,
    lastError: row.lastError,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: ERROR_CODES.NOT_FOUND,
    message: 'Webhook endpoint not found',
  });
}
