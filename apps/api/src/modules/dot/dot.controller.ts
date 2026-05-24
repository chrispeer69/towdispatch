/**
 * DotController — operator-side REST surface for Full DOT Compliance
 * (Session 37).
 *
 * RBAC:
 *   OWNER, ADMIN, MANAGER            — full control (writes)
 *   OWNER, ADMIN, MANAGER, AUDITOR   — read access (lists / reports / packet)
 *   DISPATCHER, ACCOUNTING, DRIVER   — no access
 *
 * Money is not handled here. All timestamps are UTC ISO-8601 over the wire;
 * the audit packet streams as application/pdf. DVIR entry lives in the
 * fleet module — this surface only reads DVIR for reporting.
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ROLES,
  type RecordDqEventPayload,
  type RecordDrugTestPayload,
  type RecordHosEntryPayload,
  type RecordIncidentPayload,
  type UpsertDotCarrierProfilePayload,
  auditPacketQuerySchema,
  listDrugTestFilterSchema,
  listHosFilterSchema,
  recordDqEventSchema,
  recordDrugTestSchema,
  recordHosEntrySchema,
  recordIncidentSchema,
  upsertDotCarrierProfileSchema,
} from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { DotService } from './dot.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER] as const;

const driverIdParam = z.object({ driverId: z.string().uuid() });
const hosViolationsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

@UseGuards(RolesGuard)
@Controller('dot')
export class DotController {
  constructor(private readonly service: DotService) {}

  // ---------------- Carrier profile ----------------

  @Get('carrier-profile')
  @Roles(...READERS)
  async getCarrierProfile(@Req() req: FastifyRequest) {
    return this.service.getCarrierProfile(this.ctx(req));
  }

  @Put('carrier-profile')
  @Roles(...WRITERS)
  async upsertCarrierProfile(
    @Req() req: FastifyRequest,
    @ZodBody(upsertDotCarrierProfileSchema) body: UpsertDotCarrierProfilePayload,
  ) {
    return this.service.upsertCarrierProfile(this.ctx(req), body);
  }

  // ---------------- Driver qualifications ----------------

  @Get('drivers/dq')
  @Roles(...READERS)
  async listDq(@Req() req: FastifyRequest) {
    return this.service.listDriverDqViews(this.ctx(req));
  }

  @Get('drivers/:driverId/dq')
  @Roles(...READERS)
  async getDq(@Req() req: FastifyRequest, @ZodParam(driverIdParam) p: { driverId: string }) {
    return this.service.getDriverDqView(this.ctx(req), p.driverId);
  }

  @Post('drivers/dq')
  @Roles(...WRITERS)
  async recordDq(
    @Req() req: FastifyRequest,
    @ZodBody(recordDqEventSchema) body: RecordDqEventPayload,
  ) {
    return this.service.recordDqEvent(this.ctx(req), body);
  }

  // ---------------- Hours of service ----------------

  @Get('hos')
  @Roles(...READERS)
  async listHos(
    @Req() req: FastifyRequest,
    @ZodQuery(listHosFilterSchema) filter: z.infer<typeof listHosFilterSchema>,
  ) {
    return this.service.listHosEntries(this.ctx(req), filter);
  }

  @Post('hos')
  @Roles(...WRITERS)
  async recordHos(
    @Req() req: FastifyRequest,
    @ZodBody(recordHosEntrySchema) body: RecordHosEntryPayload,
  ) {
    return this.service.recordHosEntry(this.ctx(req), body);
  }

  @Get('hos/:driverId/week')
  @Roles(...READERS)
  async hosWeek(
    @Req() req: FastifyRequest,
    @ZodParam(driverIdParam) p: { driverId: string },
    @ZodQuery(auditPacketQuerySchema) q: z.infer<typeof auditPacketQuerySchema>,
  ) {
    return this.service.getHosWeek(this.ctx(req), p.driverId, q.from, q.to);
  }

  // ---------------- Drug & alcohol ----------------

  @Get('drug-tests')
  @Roles(...READERS)
  async listDrug(
    @Req() req: FastifyRequest,
    @ZodQuery(listDrugTestFilterSchema) filter: z.infer<typeof listDrugTestFilterSchema>,
  ) {
    return this.service.listDrugTests(this.ctx(req), filter);
  }

  @Post('drug-tests')
  @Roles(...WRITERS)
  async recordDrug(
    @Req() req: FastifyRequest,
    @ZodBody(recordDrugTestSchema) body: RecordDrugTestPayload,
  ) {
    return this.service.recordDrugTest(this.ctx(req), body);
  }

  // ---------------- Incidents ----------------

  @Get('incidents')
  @Roles(...READERS)
  async listIncidents(@Req() req: FastifyRequest) {
    return this.service.listIncidents(this.ctx(req));
  }

  @Post('incidents')
  @Roles(...WRITERS)
  async recordIncident(
    @Req() req: FastifyRequest,
    @ZodBody(recordIncidentSchema) body: RecordIncidentPayload,
  ) {
    return this.service.recordIncident(this.ctx(req), body);
  }

  // ---------------- Reports ----------------

  @Get('reports/hos-violations')
  @Roles(...READERS)
  async hosViolations(
    @Req() req: FastifyRequest,
    @ZodQuery(hosViolationsQuery) q: { days?: number },
  ) {
    return this.service.hosViolationsReport(this.ctx(req), q.days ?? 90);
  }

  @Get('reports/dq-deficiencies')
  @Roles(...READERS)
  async dqDeficiencies(@Req() req: FastifyRequest) {
    return this.service.dqDeficiencyReport(this.ctx(req));
  }

  @Get('reports/open-dvirs')
  @Roles(...READERS)
  async openDvirs(@Req() req: FastifyRequest) {
    return this.service.openDvirReport(this.ctx(req));
  }

  // ---------------- Audit packet (PDF) ----------------

  @Get('audit-packet')
  @HttpCode(HttpStatus.OK)
  @Roles(...READERS)
  async auditPacket(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @ZodQuery(auditPacketQuerySchema) q: z.infer<typeof auditPacketQuerySchema>,
  ): Promise<void> {
    const buf = await this.service.generateAuditPacket(this.ctx(req), q);
    reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `attachment; filename="dot-audit-packet-${q.from}_${q.to}.pdf"`,
      )
      .send(buf);
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
