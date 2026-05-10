/**
 * BillingModule — Session 10 invoicing & billing.
 *
 * Module scope:
 *   - InvoicesService: invoice / line item / tax / payment / credit memo CRUD
 *     + the rate-engine-driven auto-generation from completed jobs.
 *   - InvoicePdfService / StatementPdfService: PDFKit-based document rendering.
 *   - BillingDeliveryService: composes PDF + storage + email.
 *   - JobCompletionListener: subscribes to job.status_changed and triggers
 *     generateFromJob() on completion.
 *
 * Imports: EmailModule (templated emails), DispatchEventsModule (subscribe to
 * job.status_changed), AuthModule (request-context guards live in
 * common/guards but the controller relies on JwtAuthGuard which is APP_GUARD).
 */
import { Module } from '@nestjs/common';
import { DispatchEventsModule } from '../dispatch/dispatch-events.module.js';
import { EmailModule } from '../email/email.module.js';
import { BillingDeliveryService } from './billing-delivery.service.js';
import { BillingController } from './billing.controller.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { InvoicesService } from './invoices.service.js';
import { JobCompletionListener } from './job-completion.listener.js';
import { StatementPdfService } from './statement-pdf.service.js';

@Module({
  imports: [DispatchEventsModule, EmailModule],
  controllers: [BillingController],
  providers: [
    InvoicesService,
    InvoicePdfService,
    StatementPdfService,
    BillingDeliveryService,
    JobCompletionListener,
  ],
  exports: [InvoicesService, BillingDeliveryService],
})
export class BillingModule {}
