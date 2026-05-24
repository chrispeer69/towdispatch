import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  controllers: [AdminController],
  providers: [AdminService],
/**
 * Hosts admin-only operational endpoints (Phase 0 hardening, Session 17).
 * Currently just GET /admin/sentry-test. SentryService comes from the global
 * ObservabilityModule and the capture happens in the global exception filter,
 * so no providers are declared here.
 */
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';

@Module({
  controllers: [AdminController],
})
export class AdminModule {}
