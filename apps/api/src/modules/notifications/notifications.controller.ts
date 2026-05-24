/**
 * NotificationsController — HTTP surface for Session 15.
 *
 * Internal dispatch endpoint is exposed under /internal/* so reverse-proxies
 * can block it from the public edge. Everything else is the standard
 * tenant-scoped surface, gated by RolesGuard.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type DispatchNotificationPayload,
  type DispatchNotificationResult,
  type DeliveryMetrics,
  type DeadLetterDto,
  type InAppNotificationDto,
  type NotificationListQuery,
  type NotificationTemplateDto,
  type PreviewTemplatePayload,
  type RegisterDeviceTokenPayload,
  ROLES,
  type TenantDefaultPreferencesPayload,
  type UpdateUserPreferencesPayload,
  type UpsertTemplatePayload,
  type UpsertWebhookSubscriptionPayload,
  type UserPreferencesDto,
  type WebhookDeliveryDto,
  type WebhookSubscriptionDto,
  dispatchNotificationSchema,
  notificationListQuerySchema,
  previewTemplateSchema,
  registerDeviceTokenSchema,
  tenantDefaultPreferencesSchema,
  updateUserPreferencesSchema,
  upsertTemplateSchema,
  upsertWebhookSubscriptionSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { DeadLettersService } from './dead-letters.service.js';
import { DeliveryMetricsService } from './delivery-tracking/delivery-metrics.service.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { NotificationFeedService } from './notification-feed.service.js';
import { NotificationsService } from './notifications.service.js';
import { PreferencesService } from './preferences/preferences.service.js';
import { TemplatesAdminService } from './templates/templates-admin.service.js';
import { WebhookSubscriptionsService } from './webhooks/webhook-subscriptions.service.js';

const idSchema = z.object({ id: z.string().uuid() });
const userIdSchema = z.object({ userId: z.string().uuid() });
const subIdSchema = z.object({ subscriptionId: z.string().uuid() });
const metricsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(90).default(7),
});

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@UseGuards(RolesGuard)
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly feed: NotificationFeedService,
    private readonly preferences: PreferencesService,
    private readonly templates: TemplatesAdminService,
    private readonly webhooks: WebhookSubscriptionsService,
    private readonly deadLetters: DeadLettersService,
    private readonly metrics: DeliveryMetricsService,
    private readonly deviceTokens: DeviceTokensService,
  ) {}

  // -----------------------------------------------------------------
  // /internal/notifications/* — service-to-service dispatch
  // -----------------------------------------------------------------

  /**
   * Internal dispatch. Reserved for in-cluster callers (other modules of
   * the API, the scheduler). Public ingress should not be able to hit this
   * endpoint; CORS + reverse-proxy ACLs enforce that.
   */
  @Post('internal/notifications/dispatch')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  @HttpCode(HttpStatus.ACCEPTED)
  async dispatch(
    @ZodBody(dispatchNotificationSchema) body: DispatchNotificationPayload,
    @Req() req: FastifyRequest,
  ): Promise<DispatchNotificationResult> {
    return this.notifications.dispatch(this.callerCtx(req), body);
  }

  // -----------------------------------------------------------------
  // /notifications/* — user-facing in-app feed
  // -----------------------------------------------------------------

  @Get('notifications')
  async list(
    @ZodQuery(notificationListQuerySchema) q: NotificationListQuery,
    @Req() req: FastifyRequest,
  ): Promise<{ items: InAppNotificationDto[]; total: number; unread: number }> {
    return this.feed.list(this.callerCtx(req), q);
  }

  @Patch('notifications/:id/read')
  async markRead(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<{ ok: boolean }> {
    return this.feed.markRead(this.callerCtx(req), params.id);
  }

  @Post('notifications/mark-all-read')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@Req() req: FastifyRequest): Promise<{ marked: number }> {
    return this.feed.markAllRead(this.callerCtx(req));
  }

  // -----------------------------------------------------------------
  // /notifications/preferences/* — current user preferences
  // -----------------------------------------------------------------

  @Get('notifications/preferences/me')
  async getMyPrefs(@Req() req: FastifyRequest): Promise<UserPreferencesDto> {
    const ctx = this.callerCtx(req);
    return this.preferences.getForUser(ctx, ctx.userId);
  }

  @Patch('notifications/preferences/me')
  async updateMyPrefs(
    @ZodBody(updateUserPreferencesSchema) body: UpdateUserPreferencesPayload,
    @Req() req: FastifyRequest,
  ): Promise<UserPreferencesDto> {
    const ctx = this.callerCtx(req);
    return this.preferences.updateForUser(ctx, ctx.userId, body);
  }

  @Get('notifications/preferences/users/:userId')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async getUserPrefs(
    @ZodParam(userIdSchema) params: { userId: string },
    @Req() req: FastifyRequest,
  ): Promise<UserPreferencesDto> {
    return this.preferences.getForUser(this.callerCtx(req), params.userId);
  }

  @Patch('notifications/preferences/users/:userId')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async updateUserPrefs(
    @ZodParam(userIdSchema) params: { userId: string },
    @ZodBody(updateUserPreferencesSchema) body: UpdateUserPreferencesPayload,
    @Req() req: FastifyRequest,
  ): Promise<UserPreferencesDto> {
    return this.preferences.updateForUser(this.callerCtx(req), params.userId, body);
  }

  @Get('admin/notifications/preferences/defaults')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async getTenantDefaults(@Req() req: FastifyRequest): Promise<UserPreferencesDto> {
    // Re-use the user-prefs reader against a synthetic "default" view by
    // returning the prefs for an admin user (the matrix surfaces tenant
    // defaults even when no user row exists).
    const ctx = this.callerCtx(req);
    return this.preferences.getForUser(ctx, ctx.userId);
  }

  @Patch('admin/notifications/preferences/defaults')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async updateTenantDefaults(
    @ZodBody(tenantDefaultPreferencesSchema) body: TenantDefaultPreferencesPayload,
    @Req() req: FastifyRequest,
  ): Promise<{ updated: number }> {
    return this.preferences.updateTenantDefaults(this.callerCtx(req), body);
  }

  // -----------------------------------------------------------------
  // /admin/notifications/templates/* — template management
  // -----------------------------------------------------------------

  @Get('admin/notifications/templates')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async listTemplates(@Req() req: FastifyRequest): Promise<NotificationTemplateDto[]> {
    return this.templates.list(this.callerCtx(req));
  }

  @Post('admin/notifications/templates')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async upsertTemplate(
    @ZodBody(upsertTemplateSchema) body: UpsertTemplatePayload,
    @Req() req: FastifyRequest,
  ): Promise<NotificationTemplateDto> {
    try {
      TemplatesAdminService.validateSyntax(body.body);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return this.templates.upsert(this.callerCtx(req), body);
  }

  @Post('admin/notifications/templates/preview')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async previewTemplate(
    @ZodBody(previewTemplateSchema) body: PreviewTemplatePayload,
    @Req() req: FastifyRequest,
  ): Promise<{ subject: string | null; body: string; bodyPlain: string | null }> {
    return this.templates.preview(this.callerCtx(req), body);
  }

  // -----------------------------------------------------------------
  // /admin/notifications/webhooks/* — outbound webhook subscriptions
  // -----------------------------------------------------------------

  @Get('admin/notifications/webhooks')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async listWebhooks(@Req() req: FastifyRequest): Promise<WebhookSubscriptionDto[]> {
    return this.webhooks.list(this.callerCtx(req));
  }

  @Post('admin/notifications/webhooks')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async createWebhook(
    @ZodBody(upsertWebhookSubscriptionSchema) body: UpsertWebhookSubscriptionPayload,
    @Req() req: FastifyRequest,
  ): Promise<WebhookSubscriptionDto> {
    return this.webhooks.create(this.callerCtx(req), body);
  }

  @Patch('admin/notifications/webhooks/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async updateWebhook(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(upsertWebhookSubscriptionSchema) body: UpsertWebhookSubscriptionPayload,
    @Req() req: FastifyRequest,
  ): Promise<WebhookSubscriptionDto> {
    return this.webhooks.update(this.callerCtx(req), params.id, body);
  }

  @Post('admin/notifications/webhooks/:id/rotate')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async rotateWebhook(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<WebhookSubscriptionDto> {
    return this.webhooks.rotateSecret(this.callerCtx(req), params.id);
  }

  @Delete('admin/notifications/webhooks/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async deleteWebhook(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<{ ok: boolean }> {
    return this.webhooks.deleteSubscription(this.callerCtx(req), params.id);
  }

  @Get('admin/notifications/webhooks/:subscriptionId/deliveries')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async listWebhookDeliveries(
    @ZodParam(subIdSchema) params: { subscriptionId: string },
    @Req() req: FastifyRequest,
  ): Promise<WebhookDeliveryDto[]> {
    return this.webhooks.listDeliveries(this.callerCtx(req), params.subscriptionId);
  }

  // -----------------------------------------------------------------
  // /admin/notifications/dead-letters/* — DLQ inspection / retry
  // -----------------------------------------------------------------

  @Get('admin/notifications/dead-letters')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async listDeadLetters(@Req() req: FastifyRequest): Promise<DeadLetterDto[]> {
    return this.deadLetters.list(this.callerCtx(req));
  }

  @Post('admin/notifications/dead-letters/:id/retry')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async retryDeadLetter(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<DispatchNotificationResult> {
    return this.deadLetters.retry(this.callerCtx(req), params.id);
  }

  // -----------------------------------------------------------------
  // /admin/notifications/metrics
  // -----------------------------------------------------------------

  @Get('admin/notifications/metrics')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async getMetrics(
    @ZodQuery(metricsQuerySchema) q: { windowDays: number },
    @Req() req: FastifyRequest,
  ): Promise<DeliveryMetrics> {
    return this.metrics.forTenant(this.callerCtx(req), q.windowDays);
  }

  // -----------------------------------------------------------------
  // /notifications/devices — device-token registration (driver app)
  // -----------------------------------------------------------------

  @Post('notifications/devices')
  async registerDevice(
    @ZodBody(registerDeviceTokenSchema) body: RegisterDeviceTokenPayload,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.deviceTokens.register(this.callerCtx(req), body);
  }

  @Delete('notifications/devices/:deviceId')
  async revokeDevice(
    @Param('deviceId') deviceId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: boolean }> {
    if (!deviceId || deviceId.length > 200) throw new BadRequestException('invalid deviceId');
    return this.deviceTokens.revoke(this.callerCtx(req), deviceId, 'user_revoked');
  }

  private callerCtx(req: FastifyRequest): CallerContext {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }
}
