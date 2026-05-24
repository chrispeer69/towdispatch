/**
 * SsoAdminController — tenant-admin management surface, mounted at
 * /admin/sso. JWT-guarded (global JwtAuthGuard) + RolesGuard restricted to
 * OWNER / ADMIN: SSO is a tenant-security control, so only the top two roles
 * configure it. CRUD for connections, SCIM token mint/revoke, and the
 * read-only login audit.
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
  type CreateSsoConnectionPayload,
  type MintScimTokenPayload,
  type MintScimTokenResponse,
  ROLES,
  type ScimTokenDto,
  type SsoConnectionDto,
  type SsoLoginAuditDto,
  type UpdateSsoConnectionPayload,
  createSsoConnectionSchema,
  mintScimTokenSchema,
  updateSsoConnectionSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { type SsoCallerCtx, SsoService } from './sso.service.js';

const ADMINS = [ROLES.OWNER, ROLES.ADMIN] as const;
const idParam = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('admin/sso')
export class SsoAdminController {
  constructor(private readonly sso: SsoService) {}

  private ctx(req: FastifyRequest): SsoCallerCtx {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }

  // ------------------------------------------------------- connections
  @Get('connections')
  @Roles(...ADMINS)
  async listConnections(@Req() req: FastifyRequest): Promise<SsoConnectionDto[]> {
    return this.sso.listConnections(this.ctx(req));
  }

  @Get('connections/:id')
  @Roles(...ADMINS)
  async getConnection(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) params: { id: string },
  ): Promise<SsoConnectionDto> {
    return this.sso.getConnection(this.ctx(req), params.id);
  }

  @Post('connections')
  @Roles(...ADMINS)
  async createConnection(
    @Req() req: FastifyRequest,
    @ZodBody(createSsoConnectionSchema) body: CreateSsoConnectionPayload,
  ): Promise<SsoConnectionDto> {
    return this.sso.createConnection(this.ctx(req), body);
  }

  @Patch('connections/:id')
  @Roles(...ADMINS)
  async updateConnection(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) params: { id: string },
    @ZodBody(updateSsoConnectionSchema) body: UpdateSsoConnectionPayload,
  ): Promise<SsoConnectionDto> {
    return this.sso.updateConnection(this.ctx(req), params.id, body);
  }

  @Delete('connections/:id')
  @Roles(...ADMINS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConnection(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) params: { id: string },
  ): Promise<void> {
    await this.sso.deleteConnection(this.ctx(req), params.id);
  }

  // ------------------------------------------------------- SCIM tokens
  @Get('tokens')
  @Roles(...ADMINS)
  async listTokens(@Req() req: FastifyRequest): Promise<ScimTokenDto[]> {
    return this.sso.listScimTokens(this.ctx(req));
  }

  @Post('tokens')
  @Roles(...ADMINS)
  async mintToken(
    @Req() req: FastifyRequest,
    @ZodBody(mintScimTokenSchema) body: MintScimTokenPayload,
  ): Promise<MintScimTokenResponse> {
    return this.sso.mintScimToken(this.ctx(req), body);
  }

  @Delete('tokens/:id')
  @Roles(...ADMINS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeToken(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) params: { id: string },
  ): Promise<void> {
    await this.sso.revokeScimToken(this.ctx(req), params.id);
  }

  // ------------------------------------------------------- audit
  @Get('audit')
  @Roles(...ADMINS)
  async listAudit(@Req() req: FastifyRequest): Promise<SsoLoginAuditDto[]> {
    return this.sso.listLoginAudit(this.ctx(req));
  }
}
