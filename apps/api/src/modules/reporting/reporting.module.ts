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
import { AgingService } from './aging/aging.service.js';
import { ReportBuilderController } from './builder/report-builder.controller.js';
import { ReportBuilderService } from './builder/report-builder.service.js';
import { ReportTemplateScheduler } from './builder/report-template-scheduler.service.js';
import { ReportExportService } from './export/report-export.service.js';
import { KpiController } from './kpi/kpi.controller.js';
import { KpiService } from './kpi/kpi.service.js';
import { PnlAgingController } from './pnl/pnl-aging.controller.js';
import { PnlService } from './pnl/pnl.service.js';
import { ReportingCacheService } from './reporting-cache.service.js';
import { ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';
import { CommissionReporter } from './reports/commission.reporter.js';
import { ComplianceReporter } from './reports/compliance.reporter.js';
import { DispatchPerformanceReporter } from './reports/dispatch-performance.reporter.js';
import { DriverPerformanceReporter } from './reports/driver-performance.reporter.js';
import { EvRecoveryReporter } from './reports/ev-recovery.reporter.js';
import { PnlReporter } from './reports/pnl.reporter.js';
import { RevenueReporter } from './reports/revenue.reporter.js';
import { StorageReporter } from './reports/storage.reporter.js';
import { TaxReporter } from './reports/tax.reporter.js';
import { ReportScheduler } from './scheduling/report-scheduler.service.js';
import { SavedReportsService } from './scheduling/saved-reports.service.js';

@Module({
  controllers: [
    ReportingController,
    // Session 53 — custom builder + KPI dashboard + P&L/aging surfaces.
    ReportBuilderController,
    KpiController,
    PnlAgingController,
  ],
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
    EvRecoveryReporter,
    // Session 53.
    ReportBuilderService,
    ReportTemplateScheduler,
    KpiService,
    PnlService,
    AgingService,
  ],
  exports: [ReportingService],
})
export class ReportingModule {}
