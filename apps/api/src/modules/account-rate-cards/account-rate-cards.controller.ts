import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type AccountRateCardDto,
  type BulkUpdateAccountRateCardPayload,
  ERROR_CODES,
  ROLES,
  type UpdateAccountContractTermsPayload,
  bulkUpdateAccountRateCardSchema,
  updateAccountContractTermsSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AccountRateCardsService } from './account-rate-cards.service.js';

const accountIdSchema = z.object({ accountId: z.string().uuid() });
const overrideIdSchema = accountIdSchema.extend({ overrideId: z.string().uuid() });
const availabilityIdSchema = accountIdSchema.extend({ availabilityId: z.string().uuid() });

/**
 * Roles mirror the rest of the admin pricing surfaces (service-rates,
 * service-catalog): Owner/Admin/Manager can mutate, Dispatcher/Accounting/
 * Auditor read. Driver has no access — account contracts and per-account
 * pricing are sensitive operator-side configuration.
 */
const READ_ROLES = [
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.DISPATCHER,
  ROLES.ACCOUNTING,
  ROLES.AUDITOR,
] as const;
const WRITE_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER] as const;

@UseGuards(RolesGuard)
@Controller('accounts')
export class AccountRateCardsController {
  constructor(private readonly svc: AccountRateCardsService) {}

  @Get(':accountId/rate-card')
  @Roles(...READ_ROLES)
  async getRateCard(
    @ZodParam(accountIdSchema) params: { accountId: string },
    @Req() req: FastifyRequest,
  ): Promise<AccountRateCardDto> {
    return this.svc.getRateCard(this.callerCtx(req), params.accountId);
  }

  @Patch(':accountId/rate-card/bulk')
  @Roles(...WRITE_ROLES)
  async bulkUpdate(
    @ZodParam(accountIdSchema) params: { accountId: string },
    @ZodBody(bulkUpdateAccountRateCardSchema) body: BulkUpdateAccountRateCardPayload,
    @Req() req: FastifyRequest,
  ): Promise<AccountRateCardDto> {
    try {
      return await this.svc.bulkUpsert(this.callerCtx(req), params.accountId, body);
    } catch (err) {
      // Surface DB CHECK violations and trigger errors as 400 so the UI
      // gets a precise message instead of a generic 500. These come back
      // as plain Error from pg; check the message shape.
      if (err instanceof Error) {
        if (
          /account_rate_overrides_value_percent_consistency_chk/i.test(err.message) ||
          /override_type/i.test(err.message)
        ) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Override value/percent does not match override_type',
          });
        }
        if (/does not match|does not exist/i.test(err.message)) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: err.message,
          });
        }
      }
      throw err;
    }
  }

  @Delete(':accountId/rate-card/overrides/:overrideId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...WRITE_ROLES)
  async deleteOverride(
    @ZodParam(overrideIdSchema) params: { accountId: string; overrideId: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.svc.deleteOverride(this.callerCtx(req), params.accountId, params.overrideId);
  }

  @Delete(':accountId/rate-card/availability/:availabilityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...WRITE_ROLES)
  async deleteAvailability(
    @ZodParam(availabilityIdSchema)
    params: { accountId: string; availabilityId: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.svc.deleteAvailability(this.callerCtx(req), params.accountId, params.availabilityId);
  }

  @Patch(':accountId/contract-terms')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...WRITE_ROLES)
  async updateContractTerms(
    @ZodParam(accountIdSchema) params: { accountId: string },
    @ZodBody(updateAccountContractTermsSchema) body: UpdateAccountContractTermsPayload,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.svc.updateContractTerms(this.callerCtx(req), params.accountId, body);
  }

  private callerCtx(req: FastifyRequest): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  } {
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
