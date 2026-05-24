/**
 * Admin module — SOC 2 audit-log reader + admin-only operational endpoints
 * (Phase 0 hardening, Session 17). AdminService backs the audit-log + anomaly
 * queries; the Sentry capture for GET /admin/sentry-test happens in the global
 * exception filter (SentryService comes from the global ObservabilityModule).
 */
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

/**
 * Hosts admin-only operational endpoints (Phase 0 hardening, Session 17).
 * AdminController injects AdminService (audit-anomaly + redaction helpers),
 * so the service is declared as a provider here.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
