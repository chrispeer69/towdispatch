/**
 * /users/invites endpoints — Admin Settings build 7 of 7.
 *
 * Sits under the existing /users module for cohesion (users CRUD + the
 * invite flow that creates new ones), but the routes are mounted at
 * /users/invite[s] to keep the contract clear: an invite is a sibling
 * resource to a user, not a sub-resource of one.
 *
 *   POST   /users/invite                  OWNER/ADMIN    create + email
 *   GET    /users/invites                 OWNER/ADMIN/MGR list, filter by status
 *   POST   /users/invite/:id/resend       OWNER/ADMIN    rotate token, re-email
 *   DELETE /users/invite/:id              OWNER/ADMIN    hard-delete pending
 *   POST   /users/accept-invite           PUBLIC         consume token, create user
 *   GET    /users/invite/preview?token=…  PUBLIC         preview for landing page
 *
 * The PUBLIC routes are decorated with @Public() so the JwtAuthGuard does
 * NOT bounce them to /login. The accept-invite controller returns just the
 * raw outcome (user + tenant + role); the web BFF wraps that response into
 * a full auth session (signs JWTs, sets cookies). Tokens are minted in
 * AuthService — UserInvitesService stays focused on the invite lifecycle.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import {
  type AcceptInvitePayload,
  type AuthenticatedResponse,
  type CreateInvitePayload,
  type PublicInvitePreview,
  ROLES,
  type UserInviteDto,
  acceptInviteSchema,
  createInviteSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { UserInvitesService } from './user-invites.service.js';

const inviteIdSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({
  status: z.enum(['pending', 'expired', 'all']).default('pending'),
});
const previewQuerySchema = z.object({ token: z.string().min(16).max(256) });

@Controller('users')
export class UserInvitesController {
  constructor(
    private readonly invites: UserInvitesService,
    private readonly auth: AuthService,
  ) {}

  // ===========================================================================
  // ADMIN — guarded routes
  // ===========================================================================
  @UseGuards(RolesGuard)
  @Post('invite')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async create(
    @ZodBody(createInviteSchema) body: CreateInvitePayload,
    @Req() req: FastifyRequest,
  ): Promise<UserInviteDto> {
    return this.invites.invite(this.callerCtx(req), body);
  }

  @UseGuards(RolesGuard)
  @Get('invites')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async list(
    @ZodQuery(listQuerySchema) query: { status: 'pending' | 'expired' | 'all' },
    @Req() req: FastifyRequest,
  ): Promise<UserInviteDto[]> {
    return this.invites.list(this.callerCtx(req), { status: query.status });
  }

  @UseGuards(RolesGuard)
  @Post('invite/:id/resend')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async resend(
    @ZodParam(inviteIdSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<UserInviteDto> {
    return this.invites.resend(this.callerCtx(req), params.id);
  }

  @UseGuards(RolesGuard)
  @Delete('invite/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(
    @ZodParam(inviteIdSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.invites.cancel(this.callerCtx(req), params.id);
  }

  // ===========================================================================
  // PUBLIC — accept-invite landing flow
  // ===========================================================================
  @Public()
  @Throttle({ burst: { limit: 30, ttl: seconds(60) } })
  @Get('invite/preview')
  async preview(
    @ZodQuery(previewQuerySchema) query: { token: string },
  ): Promise<PublicInvitePreview> {
    return this.invites.previewByToken(query.token);
  }

  @Public()
  @Throttle({
    burst: { limit: 10, ttl: seconds(60) },
    sustained: { limit: 30, ttl: seconds(3600) },
  })
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  async accept(
    @ZodBody(acceptInviteSchema) body: AcceptInvitePayload,
    @Req() req: FastifyRequest,
  ): Promise<AuthenticatedResponse> {
    const meta = {
      ipAddress: req.requestContext.ipAddress,
      userAgent: req.requestContext.userAgent,
      requestId: req.requestContext.requestId,
    };
    const outcome = await this.invites.acceptByToken(body, meta);
    // Hand off to AuthService to mint tokens + start a session. The
    // /auth/* flow is the canonical place for cookie + session creation;
    // duplicating it here would drift over time.
    return this.auth.issueSessionForUser(
      {
        tenantId: outcome.tenantId,
        userId: outcome.user.id,
        role: outcome.role,
        tenantName: outcome.tenantName,
        tenantSlug: outcome.tenantSlug,
        user: outcome.user,
      },
      meta,
    );
  }

  private callerCtx(req: FastifyRequest): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  } {
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
