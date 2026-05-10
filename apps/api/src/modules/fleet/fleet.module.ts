/**
 * FleetModule — Session 8 fleet & driver management.
 *
 * StorageModule is global so the documents service can inject the
 * StorageProvider without a re-export. TrucksService is exported because
 * a future module (dispatch board, driver app) might want to flip status
 * without re-implementing the maintenance flow.
 */
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsService } from './documents.service.js';
import { DriverTruckAssignmentsService } from './driver-truck-assignments.service.js';
import { FleetDriversService } from './drivers.service.js';
import { DvirsService } from './dvirs.service.js';
import { ExpirationsService } from './expirations.service.js';
import { FleetController } from './fleet.controller.js';
import { MaintenanceService } from './maintenance.service.js';
import { TrucksService } from './trucks.service.js';

@Module({
  imports: [StorageModule],
  controllers: [FleetController],
  providers: [
    FleetDriversService,
    TrucksService,
    DriverTruckAssignmentsService,
    DocumentsService,
    DvirsService,
    MaintenanceService,
    ExpirationsService,
  ],
  exports: [
    FleetDriversService,
    TrucksService,
    DocumentsService,
    DvirsService,
    MaintenanceService,
    ExpirationsService,
  ],
})
export class FleetModule {}
