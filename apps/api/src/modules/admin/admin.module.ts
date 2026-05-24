/**
 * Admin module — SOC 2 audit-log reader + admin-only operational endpoints
 * (Phase 0 hardening, Session 17). AdminService backs the audit-log + anomaly
 * queries; the Sentry capture for GET /admin/sentry-test happens in the global
 * exception filter (SentryService comes from the global ObservabilityModule).
 * Hosts admin-only endpoints: the SOC 2 audit-log reader (GET /admin/audit-log
 * + anomalies) and the operational GET /admin/sentry-test probe (Phase 0
 * hardening, Session 17). SentryService comes from the global
 * ObservabilityModule and capture happens in the global exception filter.
 */
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

/**
 * Hosts admin-only operational endpoints (Phase 0 hardening, Session 17).
 * AdminController injects AdminService (audit-anomaly + redaction helpers),
 * so the service is declared as a provider here.
 * Hosts admin-only operational endpoints (Phase 0 hardening, Session 17),
 * e.g. GET /admin/sentry-test which verifies the GlobalExceptionFilter →
 * Sentry capture path. AdminController injects AdminService, so it is declared
 * here as a provider.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
