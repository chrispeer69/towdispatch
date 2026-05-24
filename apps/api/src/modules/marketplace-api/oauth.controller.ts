/**
 * /oauth/* (Session 46) — the OAuth2 PKCE surface.
 *
 *   POST /oauth/authorize  operator (OWNER/ADMIN) approves an install → code
 *   POST /oauth/token      PUBLIC: app exchanges code/refresh → tokens
 *   POST /oauth/revoke     PUBLIC: app revokes its tokens
 *
 * The whole controller is behind MARKETPLACE_API_ENABLED (503 when off).
 */
import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type AuthorizeResult,
  type RevokeRequest,
  type TokenResponse,
  authorizeRequestSchema,
  revokeRequestSchema,
  tokenRequestSchema,
} from '@ustowdispatch/shared';
import type { AuthorizeRequest, TokenRequest } from '@ustowdispatch/shared';
import { ROLES } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { MarketplaceEnabledGuard } from './marketplace-enabled.guard.js';
import { OauthService } from './oauth.service.js';

@UseGuards(MarketplaceEnabledGuard)
@Controller('oauth')
export class OauthController {
  constructor(private readonly oauth: OauthService) {}

  @Post('authorize')
  @UseGuards(RolesGuard)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async authorize(
    @ZodBody(authorizeRequestSchema) body: AuthorizeRequest,
    @Req() req: FastifyRequest,
  ): Promise<AuthorizeResult> {
    const c = req.requestContext;
    return this.oauth.authorize(
      { tenantId: c.tenantId as string, userId: c.userId as string },
      body,
    );
  }

  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async token(@ZodBody(tokenRequestSchema) body: TokenRequest): Promise<TokenResponse> {
    return this.oauth.token(body);
  }

  @Public()
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(@ZodBody(revokeRequestSchema) body: RevokeRequest): Promise<{ revoked: true }> {
    await this.oauth.revoke(body);
    return { revoked: true };
  }
}
