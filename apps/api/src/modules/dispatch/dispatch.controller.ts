/**
 * Dispatch HTTP surface — board feed + driver/truck/shift lifecycle.
 *
 * The web UI calls these on initial mount; subsequent updates flow over the
 * Socket.IO gateway so nothing here is on a poll loop.
 */
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type AssignJobPayload,
  type DriverDto,
  type DriverRosterRow,
  type DriverShiftDto,
  type EndShiftPayload,
  type JobDto,
  type JobTransitionPayload,
  ROLES,
  type Role,
  type StartShiftPayload,
  type TruckDto,
  type UnassignJobPayload,
  type UpdateShiftLocationPayload,
  type UpdateShiftStatusPayload,
  assignJobSchema,
  endShiftSchema,
  jobTransitionSchema,
  startShiftSchema,
  unassignJobSchema,
  updateShiftLocationSchema,
  updateShiftStatusSchema,
} from '@towdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { JobsService } from '../jobs/jobs.service.js';
import {
  type DriverMobileJobDto,
  DriverMobileService,
  type DriverProfileMobileDto,
} from './driver-mobile.service.js';
import { DriversService } from './drivers.service.js';

const photoUploadSchema = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(160),
  contentBase64: z.string().min(1),
  capturedAt: z.string().datetime(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  tag: z.string().max(80).optional(),
});

const idSchema = z.object({ id: z.string().uuid() });
const shiftIdSchema = z.object({ id: z.string().uuid() });

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@UseGuards(RolesGuard)
@Controller('dispatch')
export class DispatchController {
  constructor(
    private readonly drivers: DriversService,
    private readonly jobs: JobsService,
    private readonly driverMobile: DriverMobileService,
  ) {}

  // ---------- Driver mobile app (Session 7) ----------

  /** Returns the driver record linked to the current authenticated user. */
  @Get('me/driver')
  @Roles(ROLES.DRIVER, ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async myDriver(@Req() req: FastifyRequest): Promise<DriverProfileMobileDto> {
    return this.driverMobile.myDriverProfile(this.callerCtx(req));
  }

  /** Active jobs assigned to the current authenticated driver. */
  @Get('my-jobs')
  @Roles(ROLES.DRIVER, ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async myJobs(@Req() req: FastifyRequest): Promise<DriverMobileJobDto[]> {
    return this.driverMobile.myJobs(this.callerCtx(req));
  }

  /**
   * Driver-uploaded job photo (pre-tow walkaround, GOA photo, customer
   * signature, etc.). Stored as a tenant document with ownerType=job.
   */
  @Post('jobs/:id/photos')
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.DRIVER, ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async uploadJobPhoto(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(photoUploadSchema) body: z.infer<typeof photoUploadSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; fileUrl: string; uploadedAt: string }> {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(body.contentBase64, 'base64');
    } catch {
      throw new BadRequestException('contentBase64 is not valid base64');
    }
    if (bytes.byteLength === 0) throw new BadRequestException('Empty upload');
    return this.driverMobile.uploadJobPhoto(this.callerCtx(req), {
      jobId: params.id,
      fileName: body.fileName,
      mimeType: body.mimeType,
      bytes,
      capturedAt: body.capturedAt,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      tag: body.tag ?? null,
    });
  }

  @Get('board')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async board(@Req() req: FastifyRequest): Promise<{
    queue: JobDto[];
    active: JobDto[];
    recentlyCompleted: JobDto[];
    roster: DriverRosterRow[];
  }> {
    const ctx = this.callerCtx(req);
    const [board, roster] = await Promise.all([
      this.jobs.dispatchBoard(ctx),
      this.drivers.roster(ctx),
    ]);
    return { ...board, roster };
  }

  @Get('drivers')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async listDrivers(@Req() req: FastifyRequest): Promise<DriverDto[]> {
    return this.drivers.listDrivers(this.callerCtx(req));
  }

  @Get('trucks')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async listTrucks(@Req() req: FastifyRequest): Promise<TruckDto[]> {
    return this.drivers.listTrucks(this.callerCtx(req));
  }

  @Get('roster')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async roster(@Req() req: FastifyRequest): Promise<DriverRosterRow[]> {
    return this.drivers.roster(this.callerCtx(req));
  }

  @Post('shifts/start')
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async startShift(
    @ZodBody(startShiftSchema) body: StartShiftPayload,
    @Req() req: FastifyRequest,
  ): Promise<DriverShiftDto> {
    return this.drivers.startShift(this.callerCtx(req), {
      driverId: body.driverId,
      ...(body.truckId !== undefined ? { truckId: body.truckId } : {}),
    });
  }

  @Post('shifts/end')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async endShift(
    @ZodBody(endShiftSchema) body: EndShiftPayload,
    @Req() req: FastifyRequest,
  ): Promise<DriverShiftDto> {
    return this.drivers.endShift(this.callerCtx(req), body.shiftId);
  }

  @Post('shifts/:id/status')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async updateShiftStatus(
    @ZodParam(shiftIdSchema) params: { id: string },
    @ZodBody(updateShiftStatusSchema) body: UpdateShiftStatusPayload,
    @Req() req: FastifyRequest,
  ): Promise<DriverShiftDto> {
    return this.drivers.updateShiftStatus(this.callerCtx(req), params.id, body.status);
  }

  @Post('shifts/:id/location')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async updateShiftLocation(
    @ZodParam(shiftIdSchema) params: { id: string },
    @ZodBody(updateShiftLocationSchema) body: UpdateShiftLocationPayload,
    @Req() req: FastifyRequest,
  ): Promise<DriverShiftDto> {
    return this.drivers.updateShiftLocation(this.callerCtx(req), params.id, body.lat, body.lng);
  }

  @Post('jobs/:id/assign')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async assign(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(assignJobSchema) body: AssignJobPayload,
    @Req() req: FastifyRequest,
  ): Promise<JobDto> {
    return this.jobs.assign(this.callerCtx(req), params.id, {
      driverId: body.driverId,
      ...(body.truckId !== undefined ? { truckId: body.truckId } : {}),
      ...(body.shiftId !== undefined ? { shiftId: body.shiftId } : {}),
    });
  }

  /**
   * Force-unassign — only owner / dispatcher / admin can pull a job back to
   * the queue once it's already been dispatched. Roles guard enforces the
   * permission; service layer enforces the state-machine guard.
   */
  @Post('jobs/:id/unassign')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER)
  async unassign(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(unassignJobSchema) body: UnassignJobPayload,
    @Req() req: FastifyRequest,
  ): Promise<JobDto> {
    return this.jobs.unassign(this.callerCtx(req), params.id, body.reason);
  }

  @Post('jobs/:id/transition')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.DRIVER)
  async transition(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(jobTransitionSchema) body: JobTransitionPayload,
    @Req() req: FastifyRequest,
  ): Promise<JobDto> {
    return this.jobs.transition(this.callerCtx(req), params.id, body.to, body.reason);
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
