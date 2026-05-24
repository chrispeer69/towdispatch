/**
 * OnboardingModule — self-serve onboarding (Session 25).
 *
 * Composes on top of the existing modules without modifying them: it imports
 * AuthModule (signup), FleetModule (trucks + drivers), UsersModule (invites),
 * and TenantsModule (company name) and injects their exported services.
 * TenantAwareDb / TransactionRunner / RateLimiterService come from the global
 * DatabaseModule / RedisModule.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { UsersModule } from '../users/users.module.js';
import { ActivationService } from './activation.service.js';
import { CaptchaService } from './captcha.service.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

@Module({
  imports: [AuthModule, FleetModule, UsersModule, TenantsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, ActivationService, CaptchaService],
  exports: [OnboardingService, ActivationService],
})
export class OnboardingModule {}
