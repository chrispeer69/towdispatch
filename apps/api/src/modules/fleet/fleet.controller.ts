/**
 * FleetController — HTTP surface for Session 8 Fleet & Driver Management.
 *
 * One controller mounted at /fleet to keep the URL surface coherent. The
 * underlying services are split (drivers / trucks / dvirs / maintenance /
 * expirations / documents / assignments).
 */
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateDriverPayload,
  type CreateDriverTruckAssignmentPayload,
  type CreateDvirPayload,
  type CreateMaintenanceRecordPayload,
  type CreateMaintenanceSchedulePayload,
  type CreateTruckPayload,
  type DocumentDto,
  type DocumentFilters,
  type DocumentOwnerType,
  type DocumentType,
  type DriverDto,
  type DriverFilters,
  type DriverTruckAssignmentDto,
  type DvirDto,
  type DvirFilters,
  type ExpirationsFilters,
  type ExpirationsResponse,
  type MaintenanceRecordDto,
  type MaintenanceScheduleDto,
  type PaginatedDrivers,
  type PaginatedTrucks,
  ROLES,
  type Role,
  type TruckDto,
  type TruckFilters,
  type UpdateDriverPayload,
  type UpdateTruckPayload,
  createDriverSchema,
  createDriverTruckAssignmentSchema,
  createDvirSchema,
  createMaintenanceRecordSchema,
  createMaintenanceScheduleSchema,
  createTruckSchema,
  documentFiltersSchema,
  documentOwnerTypeValues,
  documentTypeValues,
  driverFiltersSchema,
  dvirFiltersSchema,
  expirationsFiltersSchema,
  truckFiltersSchema,
  updateDriverSchema,
  updateTruckSchema,
} from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { DocumentsService } from './documents.service.js';
import { DriverTruckAssignmentsService } from './driver-truck-assignments.service.js';
import { FleetDriversService } from './drivers.service.js';
import { DvirsService } from './dvirs.service.js';
import { ExpirationsService } from './expirations.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { TrucksService } from './trucks.service.js';

const idSchema = z.object({ id: z.string().uuid() });

const uploadDocumentSchema = z.object({
  ownerType: z.enum(documentOwnerTypeValues),
  ownerId: z.string().uuid(),
  docType: z.enum(documentTypeValues),
  fileName: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(160),
  /** base64-encoded bytes — keeps the JSON contract uniform with the rest of the API */
  contentBase64: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@UseGuards(RolesGuard)
@Controller('fleet')
export class FleetController {
  constructor(
    private readonly driversSvc: FleetDriversService,
    private readonly trucksSvc: TrucksService,
    private readonly assignmentsSvc: DriverTruckAssignmentsService,
    private readonly documentsSvc: DocumentsService,
    private readonly dvirsSvc: DvirsService,
    private readonly maintSvc: MaintenanceService,
    private readonly expirationsSvc: ExpirationsService,
  ) {}

  // ---------- drivers ----------
  @Get('drivers')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async listDrivers(
    @ZodQuery(driverFiltersSchema) query: DriverFilters,
    @Req() req: FastifyRequest,
  ): Promise<PaginatedDrivers> {
    return this.driversSvc.list(this.callerCtx(req), query);
  }

  @Get('drivers/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async getDriver(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<DriverDto> {
    return this.driversSvc.get(this.callerCtx(req), params.id);
  }

  @Post('drivers')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async createDriver(
    @ZodBody(createDriverSchema) body: CreateDriverPayload,
    @Req() req: FastifyRequest,
  ): Promise<DriverDto> {
    return this.driversSvc.create(this.callerCtx(req), body);
  }

  @Patch('drivers/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async updateDriver(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(updateDriverSchema) body: UpdateDriverPayload,
    @Req() req: FastifyRequest,
  ): Promise<DriverDto> {
    return this.driversSvc.update(this.callerCtx(req), params.id, body);
  }

  @Delete('drivers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async deleteDriver(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.driversSvc.softDelete(this.callerCtx(req), params.id);
  }

  // ---------- trucks ----------
  @Get('trucks')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async listTrucks(
    @ZodQuery(truckFiltersSchema) query: TruckFilters,
    @Req() req: FastifyRequest,
  ): Promise<PaginatedTrucks> {
    return this.trucksSvc.list(this.callerCtx(req), query);
  }

  @Get('trucks/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async getTruck(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<TruckDto> {
    return this.trucksSvc.get(this.callerCtx(req), params.id);
  }

  @Post('trucks')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async createTruck(
    @ZodBody(createTruckSchema) body: CreateTruckPayload,
    @Req() req: FastifyRequest,
  ): Promise<TruckDto> {
    return this.trucksSvc.create(this.callerCtx(req), body);
  }

  @Patch('trucks/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async updateTruck(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(updateTruckSchema) body: UpdateTruckPayload,
    @Req() req: FastifyRequest,
  ): Promise<TruckDto> {
    return this.trucksSvc.update(this.callerCtx(req), params.id, body);
  }

  @Delete('trucks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async deleteTruck(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.trucksSvc.softDelete(this.callerCtx(req), params.id);
  }

  // ---------- driver↔truck assignments ----------
  @Get('drivers/:id/trucks')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async listAssignmentsForDriver(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<DriverTruckAssignmentDto[]> {
    return this.assignmentsSvc.listForDriver(this.callerCtx(req), params.id);
  }

  @Get('trucks/:id/drivers')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async listAssignmentsForTruck(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<DriverTruckAssignmentDto[]> {
    return this.assignmentsSvc.listForTruck(this.callerCtx(req), params.id);
  }

  @Post('assignments')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async createAssignment(
    @ZodBody(createDriverTruckAssignmentSchema) body: CreateDriverTruckAssignmentPayload,
    @Req() req: FastifyRequest,
  ): Promise<DriverTruckAssignmentDto> {
    return this.assignmentsSvc.create(this.callerCtx(req), body);
  }

  @Delete('assignments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async deleteAssignment(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.assignmentsSvc.remove(this.callerCtx(req), params.id);
  }

  // ---------- documents ----------
  @Get('documents')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async listDocuments(
    @ZodQuery(documentFiltersSchema) query: DocumentFilters,
    @Req() req: FastifyRequest,
  ): Promise<DocumentDto[]> {
    return this.documentsSvc.list(this.callerCtx(req), query);
  }

  @Post('documents')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async uploadDocument(
    @ZodBody(uploadDocumentSchema) body: z.infer<typeof uploadDocumentSchema>,
    @Req() req: FastifyRequest,
  ): Promise<DocumentDto> {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(body.contentBase64, 'base64');
    } catch {
      throw new BadRequestException('contentBase64 is not valid base64');
    }
    if (bytes.byteLength === 0) throw new BadRequestException('Empty upload');
    return this.documentsSvc.upload(this.callerCtx(req), {
      ownerType: body.ownerType as DocumentOwnerType,
      ownerId: body.ownerId,
      docType: body.docType as DocumentType,
      fileName: body.fileName,
      mimeType: body.mimeType,
      bytes,
      expiresAt: body.expiresAt ?? null,
      notes: body.notes ?? null,
    });
  }

  /**
   * Stream document bytes back to the client. Goes through DocumentsService
   * which checks tenant context (RLS) AND verifies the storage key is
   * tenant-scoped. Two layers because either alone could be defeated by a
   * future bug.
   */
  @Get('documents/:id/download')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async downloadDocument(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { bytes, doc } = await this.documentsSvc.readBytes(this.callerCtx(req), params.id);
    reply
      .header('content-type', doc.mimeType)
      .header('content-disposition', `attachment; filename="${encodeURIComponent(doc.fileName)}"`)
      .send(bytes);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async deleteDocument(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.documentsSvc.softDelete(this.callerCtx(req), params.id);
  }

  // ---------- DVIRs ----------
  @Get('dvirs')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async listDvirs(
    @ZodQuery(dvirFiltersSchema) query: DvirFilters,
    @Req() req: FastifyRequest,
  ): Promise<DvirDto[]> {
    return this.dvirsSvc.list(this.callerCtx(req), query);
  }

  @Post('dvirs')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async submitDvir(
    @ZodBody(createDvirSchema) body: CreateDvirPayload,
    @Req() req: FastifyRequest,
  ): Promise<DvirDto> {
    return this.dvirsSvc.submit(this.callerCtx(req), body);
  }

  // ---------- Maintenance ----------
  @Get('maintenance/due')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async listDueMaintenance(@Req() req: FastifyRequest): Promise<MaintenanceScheduleDto[]> {
    return this.maintSvc.listDue(this.callerCtx(req));
  }

  @Get('trucks/:id/maintenance/schedules')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async listSchedules(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<MaintenanceScheduleDto[]> {
    return this.maintSvc.listSchedulesForTruck(this.callerCtx(req), params.id);
  }

  @Get('trucks/:id/maintenance/records')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async listRecords(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<MaintenanceRecordDto[]> {
    return this.maintSvc.listRecordsForTruck(this.callerCtx(req), params.id);
  }

  @Post('maintenance/schedules')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async createSchedule(
    @ZodBody(createMaintenanceScheduleSchema) body: CreateMaintenanceSchedulePayload,
    @Req() req: FastifyRequest,
  ): Promise<MaintenanceScheduleDto> {
    return this.maintSvc.createSchedule(this.callerCtx(req), body);
  }

  @Post('maintenance/records')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async recordService(
    @ZodBody(createMaintenanceRecordSchema) body: CreateMaintenanceRecordPayload,
    @Req() req: FastifyRequest,
  ): Promise<MaintenanceRecordDto> {
    return this.maintSvc.recordService(this.callerCtx(req), body);
  }

  // ---------- Expirations ----------
  @Get('expirations')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async listExpirations(
    @ZodQuery(expirationsFiltersSchema) query: ExpirationsFilters,
    @Req() req: FastifyRequest,
  ): Promise<ExpirationsResponse> {
    return this.expirationsSvc.list(this.callerCtx(req), query);
  }

  private callerCtx(req: FastifyRequest): CallerContext {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      role: c.role as Role | null,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }
}
