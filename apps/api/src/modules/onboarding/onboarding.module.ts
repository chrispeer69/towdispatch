import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OnboardingPublicController } from './onboarding-public.controller.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

/**
 * Self-serve onboarding (Session 25). Composes AuthModule (for signup/verify)
 * and relies on the global DatabaseModule for TenantAwareDb. Owns
 * onboarding_progress + tenant_activation_events; does not modify auth.
 */
@Module({
  imports: [AuthModule],
  controllers: [OnboardingPublicController, OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
