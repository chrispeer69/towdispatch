/**
 * ReportingModule — Session 14.
 *
 * Wires:
 *   - ReportingController (REST surface)
 *   - ReportingService (dispatcher + cache + audit)
 *   - Eight Reporter implementations
 *   - ReportingCacheService (60s Redis cache)
 *   - ReportExportService (CSV + PDF)
 *   - SavedReportsService (CRUD over saved_reports + report_schedules)
 *   - ReportScheduler (setInterval poller — see scheduler comment for the
 *     deviation from the prompt's BullMQ note).
 *
 * Cross-module dependencies are kept light: Email is global; Storage is
 * global; Redis is global. Database + ConfigService come from the global
 * DatabaseModule / ConfigModule.
 */
import { Module } from '@nestjs/common';
import { ReportExportService } from './export/report-export.service.js';
import { ReportingCacheService } from './reporting-cache.service.js';
import { ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';
import { CommissionReporter } from './reports/commission.reporter.js';
import { ComplianceReporter } from './reports/compliance.reporter.js';
import { DispatchPerformanceReporter } from './reports/dispatch-performance.reporter.js';
import { DriverPerformanceReporter } from './reports/driver-performance.reporter.js';
import { PnlReporter } from './reports/pnl.reporter.js';
import { RevenueReporter } from './reports/revenue.reporter.js';
import { StorageReporter } from './reports/storage.reporter.js';
import { TaxReporter } from './reports/tax.reporter.js';
import { ReportScheduler } from './scheduling/report-scheduler.service.js';
import { SavedReportsService } from './scheduling/saved-reports.service.js';

@Module({
  controllers: [ReportingController],
  providers: [
    ReportingService,
    ReportingCacheService,
    ReportExportService,
    SavedReportsService,
    ReportScheduler,
    DispatchPerformanceReporter,
    DriverPerformanceReporter,
    RevenueReporter,
    StorageReporter,
    PnlReporter,
    CommissionReporter,
    TaxReporter,
    ComplianceReporter,
  ],
  exports: [ReportingService],
})
export class ReportingModule {}
