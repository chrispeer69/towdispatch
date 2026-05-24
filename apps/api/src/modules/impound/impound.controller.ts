/**
 * ImpoundController — operator-side REST surface for Impound & Storage.
 *
 * RBAC per the Session 22 spec:
 *   OWNER, ADMIN, DISPATCHER            — full control (writes)
 *   OWNER, ADMIN, DISPATCHER, AUDITOR   — read access (list / detail / forms)
 *   MANAGER, ACCOUNTING, DRIVER         — no access
 *
 * Decimal money is cents-as-integer throughout; all timestamps are UTC
 * ISO-8601 over the wire.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type AddImpoundFeePayload,
  type AddImpoundHoldPayload,
  type CloseImpoundRecordPayload,
  type CreateImpoundRecordPayload,
  type CreateImpoundReleasePayload,
  type CreateImpoundYardPayload,
  type ListImpoundRecordsFilter,
  ROLES,
  type RegisterImpoundPhotosPayload,
  type ReleaseImpoundHoldPayload,
  type UpdateImpoundRecordPayload,
  type UpdateImpoundYardPayload,
  addImpoundFeeSchema,
  addImpoundHoldSchema,
  closeImpoundRecordSchema,
  createImpoundRecordSchema,
  createImpoundReleaseSchema,
  createImpoundYardSchema,
  impoundFormKindValues,
  listImpoundRecordsFilterSchema,
  registerImpoundPhotosSchema,
  releaseImpoundHoldSchema,
  updateImpoundRecordSchema,
  updateImpoundYardSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ImpoundService } from './impound.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const idParam = z.object({ id: z.string().uuid() });
const yardIdParam = z.object({ yardId: z.string().uuid() });
const recordHoldParam = z.object({
  id: z.string().uuid(),
  holdId: z.string().uuid(),
});
const formParam = z.object({
  id: z.string().uuid(),
  kind: z.enum(impoundFormKindValues),
});

@UseGuards(RolesGuard)
@Controller('impound')
export class ImpoundController {
  constructor(private readonly service: ImpoundService) {}

  // ---------------- Yards ----------------

  @Get('yards')
  @Roles(...READERS)
  async listYards(@Req() req: FastifyRequest) {
    return this.service.listYards(this.ctx(req));
  }

  @Post('yards')
  @Roles(...WRITERS)
  async createYard(
    @Req() req: FastifyRequest,
    @ZodBody(createImpoundYardSchema) body: CreateImpoundYardPayload,
  ) {
    return this.service.createYard(this.ctx(req), body);
  }

  @Patch('yards/:yardId')
  @Roles(...WRITERS)
  async updateYard(
    @Req() req: FastifyRequest,
    @ZodParam(yardIdParam) p: { yardId: string },
    @ZodBody(updateImpoundYardSchema) body: UpdateImpoundYardPayload,
  ) {
    return this.service.updateYard(this.ctx(req), p.yardId, body);
  }

  @Delete('yards/:yardId')
  @Roles(...WRITERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteYard(@Req() req: FastifyRequest, @ZodParam(yardIdParam) p: { yardId: string }) {
    await this.service.softDeleteYard(this.ctx(req), p.yardId);
  }

  // ---------------- Records ----------------

  @Get('records')
  @Roles(...READERS)
  async listRecords(
    @Req() req: FastifyRequest,
    @ZodQuery(listImpoundRecordsFilterSchema)
    query: ListImpoundRecordsFilter,
  ) {
    return this.service.listRecords(this.ctx(req), query);
  }

  @Get('records/:id')
  @Roles(...READERS)
  async getRecord(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.service.getRecordDetail(this.ctx(req), p.id);
  }

  @Post('records')
  @Roles(...WRITERS)
  async intake(
    @Req() req: FastifyRequest,
    @ZodBody(createImpoundRecordSchema) body: CreateImpoundRecordPayload,
  ) {
    return this.service.intakeRecord(this.ctx(req), body);
  }

  @Patch('records/:id')
  @Roles(...WRITERS)
  async updateRecord(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(updateImpoundRecordSchema) body: UpdateImpoundRecordPayload,
  ) {
    return this.service.updateRecord(this.ctx(req), p.id, body);
  }

  @Post('records/:id/photos')
  @Roles(...WRITERS)
  async registerPhotos(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(registerImpoundPhotosSchema) body: RegisterImpoundPhotosPayload,
  ) {
    return this.service.registerPhotos(this.ctx(req), p.id, body);
  }

  @Post('records/:id/close')
  @Roles(...WRITERS)
  async closeRecord(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(closeImpoundRecordSchema) body: CloseImpoundRecordPayload,
  ) {
    return this.service.closeRecord(this.ctx(req), p.id, body);
  }

  // ---------------- Holds ----------------

  @Post('records/:id/holds')
  @Roles(...WRITERS)
  async addHold(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(addImpoundHoldSchema) body: AddImpoundHoldPayload,
  ) {
    return this.service.addHold(this.ctx(req), p.id, body);
  }

  @Post('records/:id/holds/:holdId/release')
  @Roles(...WRITERS)
  async releaseHold(
    @Req() req: FastifyRequest,
    @ZodParam(recordHoldParam) p: { id: string; holdId: string },
    @ZodBody(releaseImpoundHoldSchema) body: ReleaseImpoundHoldPayload,
  ) {
    return this.service.releaseHold(this.ctx(req), p.id, p.holdId, body);
  }

  // ---------------- Fees ----------------

  @Post('records/:id/fees')
  @Roles(...WRITERS)
  async addFee(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(addImpoundFeeSchema) body: AddImpoundFeePayload,
  ) {
    return this.service.addFee(this.ctx(req), p.id, body);
  }

  // ---------------- Release ----------------

  @Post('records/:id/release')
  @Roles(...WRITERS)
  async release(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(createImpoundReleaseSchema) body: CreateImpoundReleasePayload,
  ) {
    return this.service.releaseRecord(this.ctx(req), p.id, body);
  }

  // ---------------- Forms (Session 23 renders the documents) ----------------

  @Get('records/:id/forms/:kind')
  @Roles(...READERS)
  async formStub(
    @Req() req: FastifyRequest,
    @ZodParam(formParam) p: { id: string; kind: (typeof impoundFormKindValues)[number] },
  ) {
    return this.service.generateFormStub(this.ctx(req), p.id, p.kind);
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
