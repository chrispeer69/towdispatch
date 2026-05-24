/**
 * HeavyDutyController — operator-side REST surface for the Heavy-Duty
 * Specialist module.
 *
 * RBAC (mirrors the impound module):
 *   OWNER, ADMIN, DISPATCHER           — full control (writes)
 *   OWNER, ADMIN, DISPATCHER, AUDITOR  — read access (lists / detail / reports)
 *   MANAGER, ACCOUNTING, DRIVER        — no access
 *
 * Money is cents-as-integer; timestamps are UTC ISO-8601; cert dates are
 * YYYY-MM-DD. The controller never touches dispatch core — eligibility is
 * computed read-only by the service over the HD detail rows.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateHdRateSheetPayload,
  type FinalizeHdInvoicePayload,
  type GenerateHdEstimatePayload,
  type MarkJobHdPayload,
  ROLES,
  type RecordHdDriverCertPayload,
  type SetHdTruckCapabilitiesPayload,
  type UpdateHdRateSheetPayload,
  createHdRateSheetSchema,
  finalizeHdInvoiceSchema,
  generateHdEstimateSchema,
  markJobHdSchema,
  recordHdDriverCertSchema,
  setHdTruckCapabilitiesSchema,
  updateHdRateSheetSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { HeavyDutyService } from './heavy-duty.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const truckParam = z.object({ truckId: z.string().uuid() });
const driverParam = z.object({ driverId: z.string().uuid() });
const jobParam = z.object({ jobId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const certExpiryQuery = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).optional(),
});

@UseGuards(RolesGuard)
@Controller('heavy-duty')
export class HeavyDutyController {
  constructor(private readonly service: HeavyDutyService) {}

  // ---------------- Truck capabilities ----------------

  @Get('trucks/capabilities')
  @Roles(...READERS)
  async listTruckCapabilities(@Req() req: FastifyRequest) {
    return this.service.listTruckCapabilities(this.ctx(req));
  }

  @Get('trucks/:truckId/capabilities')
  @Roles(...READERS)
  async getTruckCapabilities(
    @Req() req: FastifyRequest,
    @ZodParam(truckParam) p: { truckId: string },
  ) {
    return this.service.getTruckCapabilities(this.ctx(req), p.truckId);
  }

  @Put('trucks/:truckId/capabilities')
  @Roles(...WRITERS)
  async setTruckCapabilities(
    @Req() req: FastifyRequest,
    @ZodParam(truckParam) p: { truckId: string },
    @ZodBody(setHdTruckCapabilitiesSchema) body: SetHdTruckCapabilitiesPayload,
  ) {
    return this.service.setTruckCapabilities(this.ctx(req), p.truckId, body);
  }

  // ---------------- Driver certifications ----------------

  @Get('drivers/:driverId/certifications')
  @Roles(...READERS)
  async listDriverCerts(
    @Req() req: FastifyRequest,
    @ZodParam(driverParam) p: { driverId: string },
  ) {
    return this.service.listDriverCerts(this.ctx(req), p.driverId);
  }

  @Post('drivers/:driverId/certifications')
  @Roles(...WRITERS)
  async recordDriverCert(
    @Req() req: FastifyRequest,
    @ZodParam(driverParam) p: { driverId: string },
    @ZodBody(recordHdDriverCertSchema) body: RecordHdDriverCertPayload,
  ) {
    return this.service.recordDriverCert(this.ctx(req), p.driverId, body);
  }

  // ---------------- Job attributes + eligibility ----------------

  @Get('jobs/:jobId')
  @Roles(...READERS)
  async getJobDetail(@Req() req: FastifyRequest, @ZodParam(jobParam) p: { jobId: string }) {
    return this.service.getJobDetail(this.ctx(req), p.jobId);
  }

  @Get('jobs/:jobId/attributes')
  @Roles(...READERS)
  async getJobAttributes(@Req() req: FastifyRequest, @ZodParam(jobParam) p: { jobId: string }) {
    return this.service.getJobAttributes(this.ctx(req), p.jobId);
  }

  @Put('jobs/:jobId')
  @Roles(...WRITERS)
  async markJobHd(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(markJobHdSchema) body: MarkJobHdPayload,
  ) {
    return this.service.markJobHd(this.ctx(req), p.jobId, body);
  }

  @Post('jobs/:jobId/estimate')
  @Roles(...WRITERS)
  async generateEstimate(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(generateHdEstimateSchema) body: GenerateHdEstimatePayload,
  ) {
    return this.service.generateOnSceneEstimate(this.ctx(req), p.jobId, body);
  }

  @Post('jobs/:jobId/finalize')
  @Roles(...WRITERS)
  async finalizeInvoice(
    @Req() req: FastifyRequest,
    @ZodParam(jobParam) p: { jobId: string },
    @ZodBody(finalizeHdInvoiceSchema) body: FinalizeHdInvoicePayload,
  ) {
    return this.service.finalizeHdInvoice(this.ctx(req), p.jobId, body);
  }

  // ---------------- Rate sheets ----------------

  @Get('rate-sheets')
  @Roles(...READERS)
  async listRateSheets(@Req() req: FastifyRequest) {
    return this.service.listRateSheets(this.ctx(req));
  }

  @Post('rate-sheets')
  @Roles(...WRITERS)
  async createRateSheet(
    @Req() req: FastifyRequest,
    @ZodBody(createHdRateSheetSchema) body: CreateHdRateSheetPayload,
  ) {
    return this.service.createRateSheet(this.ctx(req), body);
  }

  @Get('rate-sheets/:id')
  @Roles(...READERS)
  async getRateSheet(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.service.getRateSheet(this.ctx(req), p.id);
  }

  @Patch('rate-sheets/:id')
  @Roles(...WRITERS)
  async updateRateSheet(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(updateHdRateSheetSchema) body: UpdateHdRateSheetPayload,
  ) {
    return this.service.updateRateSheet(this.ctx(req), p.id, body);
  }

  @Delete('rate-sheets/:id')
  @Roles(...WRITERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRateSheet(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    await this.service.softDeleteRateSheet(this.ctx(req), p.id);
  }

  // ---------------- Reports ----------------

  @Get('reports/jobs-by-month')
  @Roles(...READERS)
  async reportJobsByMonth(@Req() req: FastifyRequest) {
    return this.service.hdJobsByMonth(this.ctx(req));
  }

  @Get('reports/cert-expiry')
  @Roles(...READERS)
  async reportCertExpiry(
    @Req() req: FastifyRequest,
    @ZodQuery(certExpiryQuery) query: { windowDays?: number },
  ) {
    return this.service.certExpiryRoster(this.ctx(req), query.windowDays ?? 60);
  }

  @Get('reports/equipment-utilization')
  @Roles(...READERS)
  async reportEquipmentUtilization(@Req() req: FastifyRequest) {
    return this.service.equipmentUtilization(this.ctx(req));
  }

  private ctx(req: FastifyRequest): { tenantId: string; userId: string; requestId: string } {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }
}
