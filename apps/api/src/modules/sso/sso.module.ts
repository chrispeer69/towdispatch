/**
 * SsoModule — Enterprise SSO (Session 38): SAML 2.0 + OIDC login + SCIM 2.0
 * provisioning. Additive; imports AuthModule to reuse JWT/session issuance
 * (no new auth realm). DatabaseModule is @Global so TenantAwareDb /
 * TransactionRunner are injectable here.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OidcProvider } from './oidc/oidc.provider.js';
import { ScimAuthGuard } from './scim/scim-auth.guard.js';
import { ScimController } from './scim/scim.controller.js';
import { ScimService } from './scim/scim.service.js';
import { SsoAdminController } from './sso-admin.controller.js';
import { SsoSecretService } from './sso-secret.service.js';
import { SsoStateService } from './sso-state.service.js';
import { SsoController } from './sso.controller.js';
import { SsoService } from './sso.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SsoController, SsoAdminController, ScimController],
  providers: [
    SsoService,
    ScimService,
    OidcProvider,
    SsoSecretService,
    SsoStateService,
    ScimAuthGuard,
  ],
})
export class SsoModule {}
