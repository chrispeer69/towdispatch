/**
 * AccountingController — Session 12 authenticated REST surface.
 *
 *   GET    /accounting/connect/status            any billing role
 *   POST   /accounting/connect/start             owner+admin
 *   POST   /accounting/connect/disconnect        owner+admin
 *   GET    /accounting/connect/callback          owner+admin (server-driven redirect)
 *   GET    /accounting/chart-of-accounts         owner+admin+accounting
 *   GET    /accounting/account-mapping           owner+admin+accounting
 *   PUT    /accounting/account-mapping           owner+admin+accounting
 *   GET    /accounting/sync-status               owner+admin+accounting
 *   POST   /accounting/sync/manual               owner+admin+accounting
 *   POST   /accounting/sync/retry/:entityType/:entityId  owner+admin+accounting
 *
 * The OAuth callback lives here (not on the public webhook controller) because
 * the operator must already be signed in to complete the flow — Intuit lands
 * back on our domain with the access cookie still attached.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  type AccountMappingDto,
  type AccountMappingsResponse,
  type AccountingConnectStartResponse,
  type AccountingConnectStatusDto,
  type AccountingDisconnectResponse,
  type ChartOfAccountsResponse,
  type ManualSyncResponse,
  ROLES,
  type RetrySyncResponse,
  type SyncStatusResponse,
  type UpdateAccountMappingPayload,
  accountingConnectCallbackQuerySchema,
  manualSyncPayloadSchema,
  updateAccountMappingSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AccountingService } from './accounting.service.js';

const entityParamSchema = z.object({
  entityType: z.enum(['customer', 'invoice', 'payment', 'refund']),
  entityId: z.string().uuid(),
});

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  role: string | null;
}

@UseGuards(RolesGuard)
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  // ===== Connect =====

  @Get('connect/status')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async connectStatus(@Req() req: FastifyRequest): Promise<AccountingConnectStatusDto> {
    return this.accounting.getConnectStatus(this.ctx(req));
  }

  @Post('connect/start')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async connectStart(@Req() req: FastifyRequest): Promise<AccountingConnectStartResponse> {
    return this.accounting.startConnect(this.ctx(req));
  }

  @Get('connect/callback')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async connectCallback(
    @ZodQuery(accountingConnectCallbackQuerySchema)
    query: { code: string; state: string; realmId: string },
    @Req() req: FastifyRequest,
  ): Promise<AccountingConnectStatusDto> {
    return this.accounting.completeConnect(this.ctx(req), query);
  }

  @Post('connect/disconnect')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async connectDisconnect(@Req() req: FastifyRequest): Promise<AccountingDisconnectResponse> {
    return this.accounting.disconnect(this.ctx(req));
  }

  // ===== Chart of accounts + mapping =====

  @Get('chart-of-accounts')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.ACCOUNTING)
  async chartOfAccounts(@Req() req: FastifyRequest): Promise<ChartOfAccountsResponse> {
    return this.accounting.getChartOfAccounts(this.ctx(req));
  }

  @Get('account-mapping')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.ACCOUNTING)
  async listMappings(@Req() req: FastifyRequest): Promise<AccountMappingsResponse> {
    return this.accounting.getMappings(this.ctx(req));
  }

  @Put('account-mapping')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.ACCOUNTING)
  async upsertMapping(
    @ZodBody(updateAccountMappingSchema) body: UpdateAccountMappingPayload,
    @Req() req: FastifyRequest,
  ): Promise<AccountMappingDto> {
    return this.accounting.upsertMapping(this.ctx(req), {
      internalCategory: body.internalCategory,
      externalAccountId: body.externalAccountId,
      ...(body.externalAccountName !== undefined
        ? { externalAccountName: body.externalAccountName }
        : {}),
      ...(body.externalAccountType !== undefined
        ? { externalAccountType: body.externalAccountType }
        : {}),
    });
  }

  // ===== Sync =====

  @Get('sync-status')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.ACCOUNTING)
  async syncStatus(@Req() req: FastifyRequest): Promise<SyncStatusResponse> {
    return this.accounting.getSyncStatusSummary(this.ctx(req));
  }

  @Post('sync/manual')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.ACCOUNTING)
  async manualSync(
    @ZodBody(manualSyncPayloadSchema) body: {
      entityType: 'customer' | 'invoice' | 'payment' | 'refund';
      entityId: string;
    },
    @Req() req: FastifyRequest,
  ): Promise<ManualSyncResponse> {
    return this.accounting.manualSync(this.ctx(req), body);
  }

  @Post('sync/retry/:entityType/:entityId')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.ACCOUNTING)
  async retrySync(
    @ZodParam(entityParamSchema)
    params: { entityType: 'customer' | 'invoice' | 'payment' | 'refund'; entityId: string },
    @Req() req: FastifyRequest,
  ): Promise<RetrySyncResponse> {
    return this.accounting.retrySync(this.ctx(req), params.entityType, params.entityId);
  }

  private ctx(req: FastifyRequest): CallerContext {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      role: (c.role as string | null) ?? null,
    };
  }
}
