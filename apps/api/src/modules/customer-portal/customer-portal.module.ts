/**
 * CustomerPortalModule — White-Label Customer Portal (Session 32).
 *
 * Two surfaces:
 *   - Staff branding admin (TenantBrandingController) — operator JWT + RBAC.
 *   - Customer portal (PortalPublic/PortalAccount controllers) — a SEPARATE
 *     auth realm (PortalAuthGuard, -portal JWT audience, customer_portal_users)
 *     that can never touch the operator API.
 *
 * Depends on AuthModule for the shared JwtService + PasswordService. The
 * database (TenantAwareDb + TransactionRunner), email, storage and config
 * providers are all @Global, so no further imports are needed. Payments are
 * NOT imported — the portal hands customers to the existing public /pay/[token]
 * flow rather than calling Stripe directly.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PortalAccountController } from './portal-account.controller.js';
import { PortalAccountService } from './portal-account.service.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalAuthService } from './portal-auth.service.js';
import { PortalPublicController } from './portal-public.controller.js';
import { TenantBrandingController } from './tenant-branding.controller.js';
import { TenantBrandingService } from './tenant-branding.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PortalPublicController, PortalAccountController, TenantBrandingController],
  providers: [PortalAuthService, PortalAccountService, TenantBrandingService, PortalAuthGuard],
  exports: [PortalAuthService, PortalAccountService, TenantBrandingService],
})
export class CustomerPortalModule {}
