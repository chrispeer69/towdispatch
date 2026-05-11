/**
 * ReportingModule — Session 14.
 *
 * Wires every report service, the saved-report CRUD, the export pipeline,
 * the scheduler, and the cache invalidation listener.
 *
 * Side-channel: subscribes to DispatchEvents (job created/status changed)
 * via DispatchEventsService — when an entity changes we invalidate the
 * affected report families on that tenant's cache.
 */
import { Module, type OnModuleInit } from '@nestjs/common';
import { DispatchEventsModule } from '../dispatch/dispatch-events.module.js';
import { DispatchEventsService } from '../dispatch/dispatch-events.service.js';
import { EmailModule } from '../email/email.module.js';
import { ReportExportService } from './export.service.js';
import { ReportingCacheService } from './reporting-cache.service.js';
import { ReportingReadService } from './reporting-read.service.js';
import { ReportingController } from './reporting.controller.js';
import { SavedReportsService } from './saved-reports.service.js';
import { ReportSchedulerService } from './scheduling/report-scheduler.service.js';
import { CommissionReportService } from './services/commission.report.service.js';
import { ComplianceReportService } from './services/compliance.report.service.js';
import { DispatchReportService } from './services/dispatch.report.service.js';
import { DriverReportService } from './services/driver.report.service.js';
import { PnlReportService } from './services/pnl.report.service.js';
import { RevenueReportService } from './services/revenue.report.service.js';
import { StorageReportService } from './services/storage.report.service.js';
import { TaxReportService } from './services/tax.report.service.js';

@Module({
  imports: [DispatchEventsModule, EmailModule],
  controllers: [ReportingController],
  providers: [
    ReportingReadService,
    ReportingCacheService,
    ReportExportService,
    SavedReportsService,
    DispatchReportService,
    DriverReportService,
    RevenueReportService,
    StorageReportService,
    PnlReportService,
    CommissionReportService,
    TaxReportService,
    ComplianceReportService,
    ReportSchedulerService,
  ],
  exports: [ReportingCacheService],
})
export class ReportingModule implements OnModuleInit {
  constructor(
    private readonly cache: ReportingCacheService,
    private readonly events: DispatchEventsService,
  ) {}

  onModuleInit(): void {
    // Cache invalidation: any job lifecycle event drops dispatch + driver +
    // revenue + commission + pnl + compliance caches for the tenant. We err
    // on the side of dropping more rather than less — the 60s TTL means
    // a missed invalidation hurts for at most a minute, but the same is
    // true for any reasonable read-pattern.
    this.events.subscribe((tenantId) => {
      this.cache.invalidateTenant(tenantId).catch(() => {
        // best-effort cache invalidation; the TTL is the safety net.
      });
    });
  }
}
