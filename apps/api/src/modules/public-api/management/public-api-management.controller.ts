/**
 * Operator-facing management surface for the Public API (session-auth'd).
 * OWNER/ADMIN only — minting credentials and registering external sinks is
 * sensitive. The /v1 consumer surface is a separate controller (API-key auth).
 *
 * Paths (proxied by the web app under /api/public-api/*):
 *   GET  /public-api/keys
 *   POST /public-api/keys
 *   POST /public-api/keys/:id/revoke
 *   GET  /public-api/webhooks
 *   POST /public-api/webhooks
 *   PATCH/DELETE /public-api/webhooks/:id
 *   GET  /public-api/webhooks/:id/deliveries
 *   POST /public-api/webhooks/:id/test
 *   POST /public-api/webhooks/deliveries/:deliveryId/retry
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateApiKeyPayload,
  type CreateWebhookEndpointPayload,
  ROLES,
  type UpdateWebhookEndpointPayload,
  createApiKeySchema,
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { ApiKeysService } from './public-api-keys.service.js';
import { WebhooksService } from './webhooks.service.js';

const MANAGERS = [ROLES.OWNER, ROLES.ADMIN] as const;
const idParam = z.object({ id: z.string().uuid() });
const deliveryParam = z.object({ deliveryId: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('public-api')
export class PublicApiManagementController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ---------------- API keys ----------------

  @Get('keys')
  @Roles(...MANAGERS)
  async listKeys(@Req() req: FastifyRequest) {
    return this.keys.list(this.ctx(req));
  }

  @Post('keys')
  @Roles(...MANAGERS)
  async createKey(
    @Req() req: FastifyRequest,
    @ZodBody(createApiKeySchema) body: CreateApiKeyPayload,
  ) {
    return this.keys.create(this.ctx(req), body);
  }

  @Post('keys/:id/revoke')
  @Roles(...MANAGERS)
  async revokeKey(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.keys.revoke(this.ctx(req), p.id);
  }

  // ---------------- Webhook endpoints ----------------

  @Get('webhooks')
  @Roles(...MANAGERS)
  async listWebhooks(@Req() req: FastifyRequest) {
    return this.webhooks.listEndpoints(this.ctx(req));
  }

  @Post('webhooks')
  @Roles(...MANAGERS)
  async createWebhook(
    @Req() req: FastifyRequest,
    @ZodBody(createWebhookEndpointSchema) body: CreateWebhookEndpointPayload,
  ) {
    return this.webhooks.createEndpoint(this.ctx(req), body);
  }

  @Patch('webhooks/:id')
  @Roles(...MANAGERS)
  async updateWebhook(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(updateWebhookEndpointSchema) body: UpdateWebhookEndpointPayload,
  ) {
    return this.webhooks.updateEndpoint(this.ctx(req), p.id, body);
  }

  @Delete('webhooks/:id')
  @Roles(...MANAGERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWebhook(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    await this.webhooks.deleteEndpoint(this.ctx(req), p.id);
  }

  @Get('webhooks/:id/deliveries')
  @Roles(...MANAGERS)
  async listDeliveries(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.webhooks.listDeliveries(this.ctx(req), p.id);
  }

  @Post('webhooks/:id/test')
  @Roles(...MANAGERS)
  async testWebhook(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.webhooks.testSend(this.ctx(req), p.id);
  }

  @Post('webhooks/deliveries/:deliveryId/retry')
  @Roles(...MANAGERS)
  async retryDelivery(
    @Req() req: FastifyRequest,
    @ZodParam(deliveryParam) p: { deliveryId: string },
  ) {
    return this.webhooks.retryDelivery(this.ctx(req), p.deliveryId);
  }

  private ctx(req: FastifyRequest): { tenantId: string; userId: string; requestId: string } {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }
}
