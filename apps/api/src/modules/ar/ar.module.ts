/**
 * ArModule — Build 5. Wires the A/R management surface (search, reports,
 * statements, RED ALERT cron, tenant invoice defaults).
 *
 * Statement generation re-uses the existing BillingModule's
 * InvoicesService + StatementPdfService — we import BillingModule so
 * those providers are available without duplicating wiring.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BillingModule } from '../billing/billing.module.js';
import { EmailModule } from '../email/email.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ArExportService } from './ar-export.service.js';
import { ArReportsService } from './ar-reports.service.js';
import { ArSearchService } from './ar-search.service.js';
import { ArController } from './ar.controller.js';
import { RedAlertService } from './red-alert.service.js';
import { RedAlertTask } from './red-alert.task.js';
import { StatementsService } from './statements.service.js';

@Module({
  imports: [
    // Wire @nestjs/schedule so the @Cron decorator on RedAlertTask
    // actually fires. forRoot() is idempotent across modules but
    // we co-locate the call here so removing AR removes the cron.
    ScheduleModule.forRoot(),
    BillingModule,
    EmailModule,
    StorageModule,
  ],
  controllers: [ArController],
  providers: [
    ArSearchService,
    ArReportsService,
    ArExportService,
    StatementsService,
    RedAlertService,
    RedAlertTask,
  ],
  exports: [ArSearchService, RedAlertService],
})
export class ArModule {}
