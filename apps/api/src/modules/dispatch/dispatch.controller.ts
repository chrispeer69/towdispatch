/**
 * Dispatch HTTP surface — board feed + driver/truck/shift lifecycle.
 *
 * The web UI calls these on initial mount; subsequent updates flow over the
 * Socket.IO gateway so nothing here is on a poll loop.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  type AssignJobPayload,
  type DriverDto,
  type DriverRosterRow,
  type DriverShiftDto,
  type EndShiftPayload,
  type JobDto,
  type JobTransitionPayload,
  ROLES,
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
} from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { JobsService } from '../jobs/jobs.service.js';
import { DriversService } from './drivers.service.js';

const idSchema = z.object({ id: z.string().uuid() });
const shiftIdSchema = z.object({ id: z.string().uuid() });

interface CallerContext {
  tenantId: string;
  userId: string;
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
  ) {}

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
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
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
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
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
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }
}
