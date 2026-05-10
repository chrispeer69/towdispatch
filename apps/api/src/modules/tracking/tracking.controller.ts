/**
 * Authenticated tracking controller — used by the dispatch board for the
 * "Tracking" badge, the message thread, and resend/revoke controls.
 *
 * The public /track/* surface lives in tracking-public.controller.ts.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  ROLES,
  type SendTrackingMessagePayload,
  type TrackingLinkDto,
  type TrackingMessageDto,
  resendTrackingSmsSchema,
  sendTrackingMessageSchema,
} from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TrackingService } from './tracking.service.js';

const idSchema = z.object({ jobId: z.string().uuid() });

interface AuthCtx {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@UseGuards(RolesGuard)
@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(':jobId')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async get(
    @ZodParam(idSchema) params: { jobId: string },
    @Req() req: FastifyRequest,
  ): Promise<{ link: TrackingLinkDto | null }> {
    const link = await this.tracking.getByJob(this.ctx(req), params.jobId);
    return { link };
  }

  @Get(':jobId/messages')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async listMessages(
    @ZodParam(idSchema) params: { jobId: string },
    @Req() req: FastifyRequest,
  ): Promise<{ messages: TrackingMessageDto[] }> {
    const messages = await this.tracking.listMessagesForJob(this.ctx(req), params.jobId);
    return { messages };
  }

  @Post(':jobId/messages')
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async sendMessage(
    @ZodParam(idSchema) params: { jobId: string },
    @ZodBody(sendTrackingMessageSchema) body: SendTrackingMessagePayload,
    @Req() req: FastifyRequest,
  ): Promise<TrackingMessageDto> {
    return this.tracking.sendDispatcherMessage(this.ctx(req), params.jobId, body.body);
  }

  @Post(':jobId/resend')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async resend(
    @ZodParam(idSchema) params: { jobId: string },
    @ZodBody(resendTrackingSmsSchema) body: { to?: string },
    @Req() req: FastifyRequest,
  ): Promise<TrackingLinkDto> {
    return this.tracking.resendSms(this.ctx(req), params.jobId, body.to);
  }

  /**
   * Generate (or reuse) a tracking link without sending an SMS — used when
   * the dispatcher wants the URL to copy/paste manually.
   */
  @Post(':jobId/link')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async ensureLink(
    @ZodParam(idSchema) params: { jobId: string },
    @Body() body: { sendSms?: boolean },
    @Req() req: FastifyRequest,
  ): Promise<TrackingLinkDto> {
    return this.tracking.ensureForJob(this.ctx(req), params.jobId, {
      sendSms: !!body?.sendSms,
    });
  }

  @Post(':jobId/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async revoke(
    @ZodParam(idSchema) params: { jobId: string },
    @Req() req: FastifyRequest,
  ): Promise<{ link: TrackingLinkDto | null }> {
    const link = await this.tracking.revoke(this.ctx(req), params.jobId);
    return { link };
  }

  /**
   * Tenant-wide tracking analytics for the reporting dashboard. Light tile —
   * counts by SMS status, click-through rate, average time-to-first-view,
   * average view duration. No per-job breakdown here.
   */
  @Get('reporting/summary')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async reporting(@Req() req: FastifyRequest): Promise<{
    smsSent: number;
    smsDelivered: number;
    smsFailed: number;
    smsSkipped: number;
    linksViewed: number;
    avgTimeToFirstViewSeconds: number | null;
    ratingsCount: number;
    avgRating: number | null;
  }> {
    return this.tracking.reportingSummary(this.ctx(req));
  }

  private ctx(req: FastifyRequest): AuthCtx {
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
