/**
 * Repo Workflow operator/driver REST surface (Session 49).
 *
 * Two controllers: /lienholders (the client book) and /repo-cases (the case
 * lifecycle). Both gated by RolesGuard and the REPO_MODULE_ENABLED flag —
 * when the module is off every route returns 503 repo_module_disabled rather
 * than silently accepting writes (ships-dark pattern, mirrors VoiceDriver).
 *
 * RBAC: OWNER/ADMIN/DISPATCHER write; AUDITOR additionally reads. Money is
 * integer cents; timestamps are UTC ISO-8601 over the wire. RFC 9457
 * problem+json is produced by the GlobalExceptionFilter from the thrown
 * Nest exceptions' { code, message }.
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
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  type AddRepoConditionPhotosPayload,
  type AddRepoPersonalPropertyPayload,
  type CloseRepoCasePayload,
  type CreateLienholderPayload,
  type CreateRepoCasePayload,
  ERROR_CODES,
  type GenerateRepoInvoicePayload,
  type ListLienholdersFilter,
  type ListRepoCasesFilter,
  type MarkRepoCaseLocatedPayload,
  ROLES,
  type RecordRepoAttemptPayload,
  type RecordRepoRecoveryPayload,
  type ReleaseRepoPersonalPropertyPayload,
  type UpdateLienholderPayload,
  type UpdateRepoCasePayload,
  addRepoConditionPhotosSchema,
  addRepoPersonalPropertySchema,
  closeRepoCaseSchema,
  createLienholderSchema,
  createRepoCaseSchema,
  generateRepoInvoiceSchema,
  listLienholdersFilterSchema,
  listRepoCasesFilterSchema,
  markRepoCaseLocatedSchema,
  recordRepoAttemptSchema,
  recordRepoRecoverySchema,
  releaseRepoPersonalPropertySchema,
  updateLienholderSchema,
  updateRepoCaseSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ConfigService } from '../../config/config.service.js';
import { type RepoCallerCtx, RepoCaseService } from './repo-case.service.js';
import { LienholderService } from './repo-lienholder.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const idParam = z.object({ id: z.string().uuid() });
const propertyParam = z.object({ id: z.string().uuid(), propertyId: z.string().uuid() });

function ctxOf(req: FastifyRequest): RepoCallerCtx {
  const c = req.requestContext;
  return {
    tenantId: c.tenantId as string,
    userId: c.userId as string,
    requestId: c.requestId,
  };
}

function assertEnabled(config: ConfigService): void {
  if (!config.repoModuleEnabled) {
    throw new ServiceUnavailableException({
      code: ERROR_CODES.REPO_MODULE_DISABLED,
      message: 'The repossession module is not enabled for this deployment.',
    });
  }
}

@UseGuards(RolesGuard)
@Controller('lienholders')
export class LienholderController {
  constructor(
    private readonly service: LienholderService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Roles(...READERS)
  async list(
    @Req() req: FastifyRequest,
    @ZodQuery(listLienholdersFilterSchema) query: ListLienholdersFilter,
  ) {
    assertEnabled(this.config);
    return this.service.list(ctxOf(req), query);
  }

  @Get(':id')
  @Roles(...READERS)
  async get(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    assertEnabled(this.config);
    return this.service.get(ctxOf(req), p.id);
  }

  @Post()
  @Roles(...WRITERS)
  async create(
    @Req() req: FastifyRequest,
    @ZodBody(createLienholderSchema) body: CreateLienholderPayload,
  ) {
    assertEnabled(this.config);
    return this.service.create(ctxOf(req), body);
  }

  @Patch(':id')
  @Roles(...WRITERS)
  async update(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(updateLienholderSchema) body: UpdateLienholderPayload,
  ) {
    assertEnabled(this.config);
    return this.service.update(ctxOf(req), p.id, body);
  }

  @Delete(':id')
  @Roles(...WRITERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    assertEnabled(this.config);
    await this.service.softDelete(ctxOf(req), p.id);
  }
}

@UseGuards(RolesGuard)
@Controller('repo-cases')
export class RepoCaseController {
  constructor(
    private readonly service: RepoCaseService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Roles(...READERS)
  async list(
    @Req() req: FastifyRequest,
    @ZodQuery(listRepoCasesFilterSchema) query: ListRepoCasesFilter,
  ) {
    assertEnabled(this.config);
    return this.service.listCases(ctxOf(req), query);
  }

  @Get(':id')
  @Roles(...READERS)
  async detail(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    assertEnabled(this.config);
    return this.service.getCaseDetail(ctxOf(req), p.id);
  }

  @Post()
  @Roles(...WRITERS)
  async create(
    @Req() req: FastifyRequest,
    @ZodBody(createRepoCaseSchema) body: CreateRepoCasePayload,
  ) {
    assertEnabled(this.config);
    return this.service.createCase(ctxOf(req), body);
  }

  @Patch(':id')
  @Roles(...WRITERS)
  async update(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(updateRepoCaseSchema) body: UpdateRepoCasePayload,
  ) {
    assertEnabled(this.config);
    return this.service.updateCase(ctxOf(req), p.id, body);
  }

  @Post(':id/located')
  @Roles(...WRITERS)
  async located(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(markRepoCaseLocatedSchema) body: MarkRepoCaseLocatedPayload,
  ) {
    assertEnabled(this.config);
    return this.service.markLocated(ctxOf(req), p.id, body);
  }

  @Post(':id/attempts')
  @Roles(...WRITERS)
  async recordAttempt(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(recordRepoAttemptSchema) body: RecordRepoAttemptPayload,
  ) {
    assertEnabled(this.config);
    return this.service.recordAttempt(ctxOf(req), p.id, body);
  }

  @Post(':id/recovery')
  @Roles(...WRITERS)
  async recordRecovery(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(recordRepoRecoverySchema) body: RecordRepoRecoveryPayload,
  ) {
    assertEnabled(this.config);
    return this.service.recordRecovery(ctxOf(req), p.id, body);
  }

  @Post(':id/condition-photos')
  @Roles(...WRITERS)
  async addConditionPhotos(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(addRepoConditionPhotosSchema) body: AddRepoConditionPhotosPayload,
  ) {
    assertEnabled(this.config);
    return this.service.addConditionPhotos(ctxOf(req), p.id, body);
  }

  @Post(':id/personal-property')
  @Roles(...WRITERS)
  async addPersonalProperty(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(addRepoPersonalPropertySchema) body: AddRepoPersonalPropertyPayload,
  ) {
    assertEnabled(this.config);
    return this.service.addPersonalProperty(ctxOf(req), p.id, body);
  }

  @Post(':id/personal-property/:propertyId/release')
  @Roles(...WRITERS)
  async releasePersonalProperty(
    @Req() req: FastifyRequest,
    @ZodParam(propertyParam) p: { id: string; propertyId: string },
    @ZodBody(releaseRepoPersonalPropertySchema) body: ReleaseRepoPersonalPropertyPayload,
  ) {
    assertEnabled(this.config);
    return this.service.releasePersonalProperty(ctxOf(req), p.id, p.propertyId, body);
  }

  @Post(':id/close')
  @Roles(...WRITERS)
  async close(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(closeRepoCaseSchema) body: CloseRepoCasePayload,
  ) {
    assertEnabled(this.config);
    return this.service.closeCase(ctxOf(req), p.id, body);
  }

  @Post(':id/invoice-preview')
  @Roles(...READERS)
  async invoicePreview(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(generateRepoInvoiceSchema) body: GenerateRepoInvoicePayload,
  ) {
    assertEnabled(this.config);
    return this.service.previewInvoice(ctxOf(req), p.id, body);
  }
}
