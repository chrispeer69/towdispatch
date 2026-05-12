/**
 * ImportModule — Session 16 Towbook importer.
 *
 * Wires every importer plus the orchestrator, the controller, and the
 * reconciliation service. Depends on StorageModule for the attachment
 * pipeline.
 */
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { BundleService } from './bundle.service.js';
import { ImportRunService } from './import-run.service.js';
import { ImportController } from './import.controller.js';
import { AttachmentImporter } from './importers/attachment.importer.js';
import { CustomerImporter } from './importers/customer.importer.js';
import { DriverImporter } from './importers/driver.importer.js';
import { ImpoundImporter } from './importers/impound.importer.js';
import { InvoiceImporter } from './importers/invoice.importer.js';
import { JobImporter } from './importers/job.importer.js';
import { MotorClubHistoryImporter } from './importers/motor-club-history.importer.js';
import { PaymentImporter } from './importers/payment.importer.js';
import { TruckImporter } from './importers/truck.importer.js';
import { VehicleImporter } from './importers/vehicle.importer.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({
  imports: [StorageModule],
  controllers: [ImportController],
  providers: [
    BundleService,
    ImportRunService,
    ReconciliationService,
    CustomerImporter,
    VehicleImporter,
    DriverImporter,
    TruckImporter,
    JobImporter,
    ImpoundImporter,
    InvoiceImporter,
    PaymentImporter,
    MotorClubHistoryImporter,
    AttachmentImporter,
  ],
  exports: [ImportRunService, ReconciliationService],
})
export class ImportModule {}
