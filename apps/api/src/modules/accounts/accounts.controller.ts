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
  type AccountDto,
  type AccountFilters,
  type AccountSearchQuery,
  type CreateAccountPayload,
  type PaginatedAccounts,
  ROLES,
  type UpdateAccountPayload,
  accountFiltersSchema,
  accountSearchQuerySchema,
  createAccountSchema,
  updateAccountSchema,
} from '@towdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AccountsService } from './accounts.service.js';

const idSchema = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  async list(
    @ZodQuery(accountFiltersSchema) query: AccountFilters,
    @Req() req: FastifyRequest,
  ): Promise<PaginatedAccounts> {
    return this.accounts.list(this.callerCtx(req), query);
  }

  @Get('search')
  async search(
    @ZodQuery(accountSearchQuerySchema) query: AccountSearchQuery,
    @Req() req: FastifyRequest,
  ): Promise<Array<Pick<AccountDto, 'id' | 'name' | 'isMotorClub' | 'active'>>> {
    return this.accounts.search(this.callerCtx(req), query);
  }

  @Get(':id')
  async get(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<AccountDto> {
    return this.accounts.get(this.callerCtx(req), params.id);
  }

  @Post()
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async create(
    @ZodBody(createAccountSchema) body: CreateAccountPayload,
    @Req() req: FastifyRequest,
  ): Promise<AccountDto> {
    return this.accounts.create(this.callerCtx(req), body);
  }

  @Patch(':id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async update(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(updateAccountSchema) body: UpdateAccountPayload,
    @Req() req: FastifyRequest,
  ): Promise<AccountDto> {
    return this.accounts.update(this.callerCtx(req), params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async remove(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.accounts.softDelete(this.callerCtx(req), params.id);
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
