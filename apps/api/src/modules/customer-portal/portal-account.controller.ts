/**
 * Portal account endpoints — authenticated by the portal session token
 * (Session 32). Every route is scoped to the caller's customer via the
 * verified JWT (PortalAuthGuard → @CurrentPortalUser); the request never
 * carries a tenant or customer id.
 *
 *   GET  /portal/me                          → identity
 *   GET  /portal/jobs                        → the customer's jobs
 *   GET  /portal/jobs/:id                    → one job (status, driver, invoice)
 *   GET  /portal/invoices                    → the customer's invoices
 *   POST /portal/invoices/:id/pay-link       → URL of the existing pay page
 *
 * Marked @Public() so the global operator JwtAuthGuard skips it; PortalAuthGuard
 * then enforces the portal token.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type {
  PortalInvoiceListResponse,
  PortalJobDetailDto,
  PortalJobListResponse,
  PortalPayLinkResponse,
  PortalUserDto,
} from '@ustowdispatch/shared';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodParam } from '../../common/decorators/zod.decorator.js';
import { CurrentPortalUser } from './current-portal-user.decorator.js';
import { PortalAccountService } from './portal-account.service.js';
import type { PortalAuthContext } from './portal-auth.guard.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalAuthService, type PortalCallerCtx } from './portal-auth.service.js';

const idParam = z.object({ id: z.string().uuid() });

@Public()
@UseGuards(PortalAuthGuard)
@Controller('portal')
export class PortalAccountController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly account: PortalAccountService,
  ) {}

  @Get('me')
  async me(@CurrentPortalUser() ctx: PortalAuthContext): Promise<PortalUserDto> {
    return this.auth.me(toCtx(ctx));
  }

  @Get('jobs')
  async listJobs(@CurrentPortalUser() ctx: PortalAuthContext): Promise<PortalJobListResponse> {
    return this.account.listJobs(toCtx(ctx));
  }

  @Get('jobs/:id')
  async getJob(
    @CurrentPortalUser() ctx: PortalAuthContext,
    @ZodParam(idParam) p: { id: string },
  ): Promise<PortalJobDetailDto> {
    return this.account.getJob(toCtx(ctx), p.id);
  }

  @Get('invoices')
  async listInvoices(
    @CurrentPortalUser() ctx: PortalAuthContext,
  ): Promise<PortalInvoiceListResponse> {
    return this.account.listInvoices(toCtx(ctx));
  }

  @Post('invoices/:id/pay-link')
  @HttpCode(HttpStatus.OK)
  async payLink(
    @CurrentPortalUser() ctx: PortalAuthContext,
    @ZodParam(idParam) p: { id: string },
  ): Promise<PortalPayLinkResponse> {
    return this.account.payLink(toCtx(ctx), p.id);
  }
}

function toCtx(ctx: PortalAuthContext): PortalCallerCtx {
  return {
    portalUserId: ctx.portalUserId,
    customerId: ctx.customerId,
    tenantId: ctx.tenantId,
  };
}
