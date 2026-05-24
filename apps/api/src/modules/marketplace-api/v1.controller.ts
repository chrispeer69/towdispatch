/**
 * /v1/* (Session 46) — DEMO public resource surface authenticated by a
 * marketplace OAuth access token (MarketplaceTokenGuard) and gated per-route by
 * @RequireScopes. It exists to exercise the OAuth flow against a real,
 * scope-checked, tenant-isolated request. @Public keeps the operator
 * JwtAuthGuard out of the way; the opaque-token guard does the auth.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { TokenIdentity } from '@ustowdispatch/shared';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentAppToken } from './current-app-token.decorator.js';
import { MarketplaceEnabledGuard } from './marketplace-enabled.guard.js';
import { MarketplaceTokenGuard } from './marketplace-token.guard.js';
import { RequireScopes } from './require-scopes.decorator.js';
import { type JobsSummary, V1Service } from './v1.service.js';

@Public()
@UseGuards(MarketplaceEnabledGuard, MarketplaceTokenGuard)
@Controller('v1')
export class V1Controller {
  constructor(private readonly v1: V1Service) {}

  /** Token introspection — the identity the bearer resolves to. */
  @Get('me')
  @RequireScopes('read:profile')
  me(@CurrentAppToken() token: TokenIdentity): TokenIdentity {
    return token;
  }

  /** Tenant-scoped job count — proves scope-gated, tenant-isolated access. */
  @Get('jobs')
  @RequireScopes('read:jobs')
  jobs(@CurrentAppToken() token: TokenIdentity): Promise<JobsSummary> {
    return this.v1.jobsSummary(token);
  }
}
