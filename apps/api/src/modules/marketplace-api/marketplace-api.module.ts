import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminReviewService } from './admin-review.service.js';
import { AdminController } from './admin.controller.js';
import { DeveloperAuthGuard } from './developer-auth.guard.js';
import { DevelopersController } from './developers.controller.js';
import { DevelopersService } from './developers.service.js';
import { DirectoryController } from './directory.controller.js';
import { DirectoryService } from './directory.service.js';
import { InstallsController } from './installs.controller.js';
import { InstallsService } from './installs.service.js';
import { MarketplaceEnabledGuard } from './marketplace-enabled.guard.js';
import { MarketplaceTokenGuard } from './marketplace-token.guard.js';
import { OauthController } from './oauth.controller.js';
import { OauthService } from './oauth.service.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import { V1Controller } from './v1.controller.js';
import { V1Service } from './v1.service.js';
import { WebhookDeliveryService } from './webhook-delivery.service.js';

/**
 * Public Marketplace API (Session 46) — third-party developer ecosystem.
 *
 * AuthModule provides JwtService (developer realm) + PasswordService;
 * DatabaseModule provides the tenant-aware + admin transaction runners. The
 * whole surface is real-gated by MARKETPLACE_API_ENABLED (default false) via
 * MarketplaceEnabledGuard on every controller. See SESSION_46_DECISIONS.md.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    OauthController,
    DevelopersController,
    DirectoryController,
    InstallsController,
    AdminController,
    V1Controller,
  ],
  providers: [
    OauthService,
    DevelopersService,
    DirectoryService,
    InstallsService,
    AdminReviewService,
    V1Service,
    WebhookDeliveryService,
    DeveloperAuthGuard,
    MarketplaceEnabledGuard,
    MarketplaceTokenGuard,
    PlatformAdminGuard,
  ],
  exports: [OauthService, DevelopersService, InstallsService],
})
export class MarketplaceApiModule {}
