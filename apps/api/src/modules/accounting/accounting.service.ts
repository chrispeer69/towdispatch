/**
 * AccountingService — the orchestrating surface around the AccountingProvider.
 *
 * Responsibilities:
 *   - Connection lifecycle: OAuth start / callback / disconnect, refresh-token
 *     rotation, encrypted persistence in accounting_connections.
 *   - Chart of accounts: pull from provider, expose to UI.
 *   - Account mapping: read / write account_mappings.
 *   - Sync entry points: enqueueInvoice/Payment/Refund/Customer plumb into the
 *     SyncEngineService. Handlers (closures registered with the engine at
 *     bootstrap) translate sync_jobs rows into provider calls — invoking
 *     syncCustomer/syncInvoice/syncPayment/syncRefund.
 *   - Operator-facing helpers: getSyncStatus, retrySync, manualSync.
 *
 * The service owns no Stripe/QBO knowledge directly — that lives in the
 * provider implementation. Configuring the provider (stub vs live) happens in
 * AccountingModule via a useFactory.
 */
import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type AccountMapping,
  type AccountMappingInternalCategory,
  type AccountingConnection,
  accountMappings,
  accountingConnections,
  customers,
  invoiceLineItems,
  invoices,
  payments,
  syncJobs,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type AccountMappingDto,
  type AccountMappingsResponse,
  type AccountingConnectStartResponse,
  type AccountingConnectStatusDto,
  type ChartOfAccountDto,
  type ChartOfAccountsResponse,
  ERROR_CODES,
  type ManualSyncResponse,
  type RetrySyncResponse,
  type SyncJobDto,
  type SyncStatusResponse,
} from '@ustowdispatch/shared';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import type {
  AccountingInvoiceLine,
  AccountingProvider,
  AccountingProviderCredentials,
} from '../../integrations/accounting/accounting-provider.interface.js';
import { ACCOUNTING_PROVIDER } from './accounting.tokens.js';
import { SyncEngineService } from './sync-engine.service.js';
import { TokenEncryptionService } from './token-encryption.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  role: string | null;
}

const STATE_BYTES = 24;
const generateOAuthState = (): string => randomBytes(STATE_BYTES).toString('base64url');
const generateVerifierToken = (): string => randomBytes(24).toString('base64url');

type ProviderIdNarrow = 'quickbooks-online' | 'quickbooks-online-stub';

@Injectable()
export class AccountingService implements OnModuleInit {
  private readonly logger: Logger;
  private readonly providerId: ProviderIdNarrow;

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly engine: SyncEngineService,
    private readonly tokens: TokenEncryptionService,
    private readonly config: ConfigService,
    @Inject(ACCOUNTING_PROVIDER) private readonly provider: AccountingProvider,
  ) {
    this.logger = config.logger.child({ component: 'accounting' });
    this.providerId = provider.descriptor.id as ProviderIdNarrow;
  }

  onModuleInit(): void {
    this.engine.configure({
      credsResolver: (tenantId) => this.resolveCredentials(tenantId),
      handlers: {
        'push.customer': async (job, provider, creds) => {
          const externalId = await this.pushCustomer(job.tenantId, job.entityId, provider, creds);
          return { externalId };
        },
        'push.invoice': async (job, provider, creds) => {
          const externalId = await this.pushInvoice(job.tenantId, job.entityId, provider, creds);
          return { externalId };
        },
        'push.payment': async (job, provider, creds) => {
          const externalId = await this.pushPayment(job.tenantId, job.entityId, provider, creds);
          return { externalId };
        },
        'push.refund': async (job, provider, creds) => {
          const externalId = await this.pushRefund(job.tenantId, job.entityId, provider, creds);
          return { externalId };
        },
        'pull.customer': async (job) => {
          // Pull-side handlers update the last_sync_at marker and exit; full
          // pull semantics (writing back into our DB) is Session 13 work.
          await this.touchLastSync(job.tenantId);
          return { externalId: null };
        },
        'pull.invoice': async (job) => {
          await this.touchLastSync(job.tenantId);
          return { externalId: null };
        },
        'pull.payment': async (job) => {
          await this.touchLastSync(job.tenantId);
          return { externalId: null };
        },
        'pull.refund': async (job) => {
          await this.touchLastSync(job.tenantId);
          return { externalId: null };
        },
      },
    });
  }

  // =====================================================================
  // Connection lifecycle
  // =====================================================================

  async getConnectStatus(ctx: CallerContext): Promise<AccountingConnectStatusDto> {
    const qbo = this.config.quickbooks;
    const conn = await this.findActiveConnection(ctx.tenantId);
    return {
      configured: qbo.configured,
      provider: this.providerId as AccountingConnectStatusDto['provider'],
      sandbox: qbo.sandbox,
      connection: conn
        ? {
            status: conn.status,
            realmId: conn.realmId,
            connectedAt: conn.connectedAt ? conn.connectedAt.toISOString() : null,
            disconnectedAt: conn.disconnectedAt ? conn.disconnectedAt.toISOString() : null,
            lastSyncAt: conn.lastSyncAt ? conn.lastSyncAt.toISOString() : null,
            lastSyncError: conn.lastSyncError,
          }
        : null,
    };
  }

  async startConnect(ctx: CallerContext): Promise<AccountingConnectStartResponse> {
    requireOwnerOrAdmin(ctx.role);
    const qbo = this.config.quickbooks;
    const state = generateOAuthState();
    const sandbox = qbo.sandbox;

    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.accountingConnections.findFirst({
        where: and(
          eq(accountingConnections.tenantId, ctx.tenantId),
          eq(accountingConnections.provider, this.providerId),
        ),
      });
      if (existing && (existing.status === 'pending' || existing.status === 'connected')) {
        // Restart: keep the row, rotate the state by storing it in
        // webhook_verifier_token (we re-issue a real verifier on success).
        await tx
          .update(accountingConnections)
          .set({
            status: 'pending',
            sandbox,
            webhookVerifierToken: state,
            updatedAt: new Date(),
          })
          .where(eq(accountingConnections.id, existing.id));
      } else {
        await tx.insert(accountingConnections).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          provider: this.providerId,
          sandbox,
          status: 'pending',
          webhookVerifierToken: state,
        });
      }
    });

    const auth = this.provider.getAuthorizationUrl({
      state,
      redirectUri: qbo.redirectUri,
      sandbox,
    });
    return { authorizationUrl: auth.url, state: auth.state };
  }

  async completeConnect(
    ctx: CallerContext,
    input: { code: string; state: string; realmId: string },
  ): Promise<AccountingConnectStatusDto> {
    const qbo = this.config.quickbooks;
    const conn = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) =>
      tx.query.accountingConnections.findFirst({
        where: and(
          eq(accountingConnections.tenantId, ctx.tenantId),
          eq(accountingConnections.provider, this.providerId),
        ),
      }),
    );
    if (!conn || conn.webhookVerifierToken !== input.state) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'invalid oauth state',
      });
    }

    const tokens = await this.provider.exchangeAuthorizationCode({
      code: input.code,
      realmId: input.realmId,
      redirectUri: qbo.redirectUri,
      sandbox: conn.sandbox,
    });

    const accessTokenExpiresAt = new Date(tokens.accessTokenExpiresAt * 1000);
    const refreshTokenExpiresAt = new Date(tokens.refreshTokenExpiresAt * 1000);
    const verifier = generateVerifierToken();

    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await tx
        .update(accountingConnections)
        .set({
          realmId: tokens.realmId,
          status: 'connected',
          encryptedAccessToken: this.tokens.encrypt(tokens.accessToken),
          encryptedRefreshToken: this.tokens.encrypt(tokens.refreshToken),
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          webhookVerifierToken: verifier,
          connectedAt: new Date(),
          disconnectedAt: null,
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(accountingConnections.id, conn.id));
    });

    return this.getConnectStatus(ctx);
  }

  async disconnect(ctx: CallerContext): Promise<{ disconnected: boolean }> {
    requireOwnerOrAdmin(ctx.role);
    const conn = await this.findActiveConnection(ctx.tenantId);
    if (!conn) return { disconnected: false };
    await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      await tx
        .update(accountingConnections)
        .set({
          status: 'disconnected',
          disconnectedAt: new Date(),
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          updatedAt: new Date(),
        })
        .where(eq(accountingConnections.id, conn.id));
    });
    return { disconnected: true };
  }

  // =====================================================================
  // Chart of accounts + mapping
  // =====================================================================

  async getChartOfAccounts(ctx: CallerContext): Promise<ChartOfAccountsResponse> {
    const creds = await this.resolveCredentials(ctx.tenantId);
    if (!creds) {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: 'No active accounting connection',
      });
    }
    const accounts: ChartOfAccountDto[] = (await this.provider.pullChartOfAccounts(creds)).map(
      (a) => ({
        externalId: a.externalId,
        name: a.name,
        type: a.type,
        ...(a.subType !== undefined ? { subType: a.subType } : {}),
        active: a.active,
      }),
    );
    return {
      provider: this.providerId as ChartOfAccountsResponse['provider'],
      accounts,
    };
  }

  async getMappings(ctx: CallerContext): Promise<AccountMappingsResponse> {
    const rows = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) =>
      tx.query.accountMappings.findMany({
        where: and(
          eq(accountMappings.tenantId, ctx.tenantId),
          eq(accountMappings.provider, this.providerId),
        ),
      }),
    );
    return {
      provider: this.providerId as AccountMappingsResponse['provider'],
      mappings: rows.map(rowToMappingDto),
    };
  }

  async upsertMapping(
    ctx: CallerContext,
    payload: {
      internalCategory: AccountMappingInternalCategory;
      externalAccountId: string;
      externalAccountName?: string;
      externalAccountType?: string;
    },
  ): Promise<AccountMappingDto> {
    requireOwnerOrAdmin(ctx.role, true);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.accountMappings.findFirst({
        where: and(
          eq(accountMappings.tenantId, ctx.tenantId),
          eq(accountMappings.provider, this.providerId),
          eq(accountMappings.internalCategory, payload.internalCategory),
        ),
      });
      let row: AccountMapping;
      if (existing) {
        const updated = await tx
          .update(accountMappings)
          .set({
            externalAccountId: payload.externalAccountId,
            externalAccountName: payload.externalAccountName ?? null,
            externalAccountType: payload.externalAccountType ?? null,
            updatedAt: new Date(),
          })
          .where(eq(accountMappings.id, existing.id))
          .returning();
        row = updated[0] as AccountMapping;
      } else {
        const inserted = await tx
          .insert(accountMappings)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            provider: this.providerId,
            internalCategory: payload.internalCategory,
            externalAccountId: payload.externalAccountId,
            externalAccountName: payload.externalAccountName ?? null,
            externalAccountType: payload.externalAccountType ?? null,
          })
          .returning();
        row = inserted[0] as AccountMapping;
      }
      return rowToMappingDto(row);
    });
  }

  // =====================================================================
  // Sync entry points (called by listeners + manual surface)
  // =====================================================================

  async enqueueCustomerSync(tenantId: string, customerId: string): Promise<string | null> {
    if (!(await this.hasActiveConnection(tenantId))) return null;
    return this.engine.enqueue(tenantId, {
      entityType: 'customer',
      entityId: customerId,
      direction: 'push',
    });
  }

  async enqueueInvoiceSync(tenantId: string, invoiceId: string): Promise<string | null> {
    if (!(await this.hasActiveConnection(tenantId))) return null;
    return this.engine.enqueue(tenantId, {
      entityType: 'invoice',
      entityId: invoiceId,
      direction: 'push',
    });
  }

  async enqueuePaymentSync(tenantId: string, paymentId: string): Promise<string | null> {
    if (!(await this.hasActiveConnection(tenantId))) return null;
    return this.engine.enqueue(tenantId, {
      entityType: 'payment',
      entityId: paymentId,
      direction: 'push',
    });
  }

  async enqueueRefundSync(tenantId: string, paymentId: string): Promise<string | null> {
    if (!(await this.hasActiveConnection(tenantId))) return null;
    return this.engine.enqueue(tenantId, {
      entityType: 'refund',
      entityId: paymentId,
      direction: 'push',
    });
  }

  async enqueuePull(
    tenantId: string,
    entityType: 'customer' | 'invoice' | 'payment' | 'refund',
    entityId: string,
    payload?: Record<string, unknown>,
  ): Promise<string | null> {
    if (!(await this.hasActiveConnection(tenantId))) return null;
    return this.engine.enqueue(tenantId, {
      entityType,
      entityId,
      direction: 'pull',
      ...(payload ? { payload } : {}),
    });
  }

  async manualSync(
    ctx: CallerContext,
    payload: {
      entityType: 'customer' | 'invoice' | 'payment' | 'refund';
      entityId: string;
    },
  ): Promise<ManualSyncResponse> {
    const conn = await this.findActiveConnection(ctx.tenantId);
    if (!conn || conn.status !== 'connected') {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: 'No active accounting connection',
      });
    }
    const jobId = await this.engine.enqueue(ctx.tenantId, {
      entityType: payload.entityType,
      entityId: payload.entityId,
      direction: 'push',
    });
    return { enqueued: jobId !== null, jobId };
  }

  async retrySync(
    ctx: CallerContext,
    entityType: 'customer' | 'invoice' | 'payment' | 'refund',
    entityId: string,
  ): Promise<RetrySyncResponse> {
    const id = await this.engine.retrySync(ctx.tenantId, entityType, entityId);
    return { retried: id !== null, jobId: id };
  }

  async getSyncStatusSummary(ctx: CallerContext): Promise<SyncStatusResponse> {
    const counts = await this.engine.countsByStatus(ctx.tenantId);
    const recent = await this.engine.listRecent(ctx.tenantId, 50);
    return {
      totals: {
        pending: counts.pending ?? 0,
        processing: counts.processing ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        deadLetter: counts.dead_letter ?? 0,
      },
      recent: recent.map(rowToSyncJobDto),
    };
  }

  // =====================================================================
  // Webhook ingestion
  // =====================================================================

  parseAndVerifyWebhook(
    rawBody: string,
    signature: string,
  ): { realmId: string; events: ReturnType<AccountingProvider['parseWebhookPayload']> } {
    const verifierToken = this.config.quickbooks.webhookVerifierToken;
    const ok = this.provider.verifyWebhookSignature(rawBody, signature, verifierToken);
    if (!ok) {
      throw new BadRequestException({
        code: 'invalid_signature',
        message: 'QuickBooks webhook signature verification failed',
      });
    }
    const events = this.provider.parseWebhookPayload(rawBody);
    const realmId = events[0]?.realmId ?? '';
    return { realmId, events };
  }

  async handleWebhookEvents(
    events: ReturnType<AccountingProvider['parseWebhookPayload']>,
  ): Promise<{
    enqueued: number;
  }> {
    let enqueued = 0;
    for (const ev of events) {
      const tenantId = await this.lookupTenantByRealm(ev.realmId);
      if (!tenantId) continue;
      for (const change of ev.changes) {
        const entityType = mapEntityType(change.entityName);
        if (!entityType) continue;
        // Webhook entityId is QBO's id (a string), but our sync_jobs.entity_id
        // is uuid (US Tow Dispatch's id). For pulls triggered by webhook we don't
        // yet know the internal id; store a placeholder so the engine can
        // record the touch (handler updates last_sync_at). We use uuidv7 to
        // keep the row unique.
        const placeholderId = uuidv7();
        const id = await this.engine.enqueue(tenantId, {
          entityType,
          entityId: placeholderId,
          direction: 'pull',
          payload: { externalId: change.entityId, operation: change.operation },
        });
        if (id) enqueued += 1;
      }
    }
    return { enqueued };
  }

  // =====================================================================
  // Internals
  // =====================================================================

  async resolveCredentials(tenantId: string): Promise<AccountingProviderCredentials | null> {
    const conn = await this.findActiveConnection(tenantId);
    if (!conn || conn.status !== 'connected') return null;
    if (!conn.encryptedAccessToken || !conn.encryptedRefreshToken) return null;
    let creds: AccountingProviderCredentials = {
      ...(conn.realmId ? { realmId: conn.realmId } : {}),
      accessToken: this.tokens.decrypt(conn.encryptedAccessToken),
      refreshToken: this.tokens.decrypt(conn.encryptedRefreshToken),
      accessTokenExpiresAt: conn.accessTokenExpiresAt
        ? Math.floor(conn.accessTokenExpiresAt.getTime() / 1000)
        : 0,
      refreshTokenExpiresAt: conn.refreshTokenExpiresAt
        ? Math.floor(conn.refreshTokenExpiresAt.getTime() / 1000)
        : 0,
      sandbox: conn.sandbox,
    };
    const now = Math.floor(Date.now() / 1000);
    if (creds.accessTokenExpiresAt - now < 60) {
      try {
        const refreshed = await this.provider.refreshTokens(creds);
        await this.admin.runAsAdmin({}, async (_db, client) => {
          await client.query(
            `UPDATE accounting_connections
                SET encrypted_access_token = $2,
                    encrypted_refresh_token = $3,
                    access_token_expires_at = to_timestamp($4),
                    refresh_token_expires_at = to_timestamp($5),
                    updated_at = now()
              WHERE id = $1::uuid`,
            [
              conn.id,
              this.tokens.encrypt(refreshed.accessToken),
              this.tokens.encrypt(refreshed.refreshToken),
              refreshed.accessTokenExpiresAt,
              refreshed.refreshTokenExpiresAt,
            ],
          );
        });
        creds = {
          ...creds,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
          refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
        };
      } catch (err) {
        this.logger.warn({ err: String(err) }, 'refresh tokens failed');
      }
    }
    return creds;
  }

  private async hasActiveConnection(tenantId: string): Promise<boolean> {
    const conn = await this.findActiveConnection(tenantId);
    return !!conn && conn.status === 'connected';
  }

  private async findActiveConnection(tenantId: string): Promise<AccountingConnection | null> {
    return this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.accountingConnections.findFirst({
        where: and(
          eq(accountingConnections.tenantId, tenantId),
          eq(accountingConnections.provider, this.providerId),
        ),
        orderBy: (c, { desc }) => desc(c.createdAt),
      });
      return row ?? null;
    });
  }

  private async lookupTenantByRealm(realmId: string): Promise<string | null> {
    return this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.accountingConnections.findFirst({
        where: and(
          eq(accountingConnections.realmId, realmId),
          eq(accountingConnections.provider, this.providerId),
        ),
      });
      return row?.tenantId ?? null;
    });
  }

  private async touchLastSync(tenantId: string): Promise<void> {
    await this.admin.runAsAdmin({}, async (_db, client) => {
      await client.query(
        `UPDATE accounting_connections SET last_sync_at = now(), updated_at = now()
          WHERE tenant_id = $1::uuid AND provider = $2`,
        [tenantId, this.providerId],
      );
    });
  }

  // =====================================================================
  // Push handlers — translate sync_jobs rows into provider calls
  // =====================================================================

  private async pushCustomer(
    tenantId: string,
    customerId: string,
    provider: AccountingProvider,
    creds: AccountingProviderCredentials,
  ): Promise<string> {
    const row = await this.admin.runAsAdmin({}, async (db) =>
      db.query.customers.findFirst({ where: eq(customers.id, customerId) }),
    );
    if (!row) throw new Error(`customer ${customerId} not found`);
    if (row.tenantId !== tenantId) throw new Error('tenant mismatch');
    const existingJob = await this.findCompletedJob(tenantId, 'customer', customerId);
    const result = await provider.syncCustomer(creds, {
      internalId: row.id,
      ...(existingJob?.externalId ? { externalId: existingJob.externalId } : {}),
      displayName: row.name,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
    });
    await this.touchLastSync(tenantId);
    return result.externalId;
  }

  private async pushInvoice(
    tenantId: string,
    invoiceId: string,
    provider: AccountingProvider,
    creds: AccountingProviderCredentials,
  ): Promise<string> {
    const inv = await this.admin.runAsAdmin({}, async (db) =>
      db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) }),
    );
    if (!inv) throw new Error(`invoice ${invoiceId} not found`);
    if (inv.tenantId !== tenantId) throw new Error('tenant mismatch');

    let customerExternalId: string | null = null;
    if (inv.customerId) {
      customerExternalId = await this.pushCustomer(tenantId, inv.customerId, provider, creds);
    } else {
      throw new Error('invoice has no customer attached — cannot sync');
    }

    const lines = await this.admin.runAsAdmin({}, async (db) =>
      db.query.invoiceLineItems.findMany({
        where: eq(invoiceLineItems.invoiceId, inv.id),
      }),
    );
    const accountingLines: AccountingInvoiceLine[] = lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitPriceCents: l.unitPriceCents,
      amountCents: l.lineTotalCents,
      internalCategory: l.lineType,
    }));

    const existing = await this.findCompletedJob(tenantId, 'invoice', invoiceId);
    const result = await provider.syncInvoice(creds, {
      internalId: inv.id,
      ...(existing?.externalId ? { externalId: existing.externalId } : {}),
      customerExternalId,
      number: inv.invoiceNumber,
      status: inv.status,
      issuedAt: (inv.issuedAt ?? inv.createdAt).toISOString(),
      dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
      totalCents: inv.totalCents,
      taxCents: inv.taxCents,
      currency: inv.currency,
      lines: accountingLines,
      ...(inv.notes ? { memo: inv.notes } : {}),
    });
    await this.touchLastSync(tenantId);
    return result.externalId;
  }

  private async pushPayment(
    tenantId: string,
    paymentId: string,
    provider: AccountingProvider,
    creds: AccountingProviderCredentials,
  ): Promise<string> {
    const pay = await this.admin.runAsAdmin({}, async (db) =>
      db.query.payments.findFirst({ where: eq(payments.id, paymentId) }),
    );
    if (!pay) throw new Error(`payment ${paymentId} not found`);
    if (pay.tenantId !== tenantId) throw new Error('tenant mismatch');
    if (pay.amountCents < 0) {
      // Refunds are recorded as negative payment rows. Route to pushRefund.
      return this.pushRefund(tenantId, paymentId, provider, creds);
    }

    // Ensure the invoice has been pushed first.
    const invoiceExternalId = await this.pushInvoice(tenantId, pay.invoiceId, provider, creds);
    const invoiceRow = await this.admin.runAsAdmin({}, async (db) =>
      db.query.invoices.findFirst({ where: eq(invoices.id, pay.invoiceId) }),
    );
    if (!invoiceRow?.customerId) throw new Error('invoice has no customer');
    const customerExternalId = await this.pushCustomer(
      tenantId,
      invoiceRow.customerId,
      provider,
      creds,
    );

    const existing = await this.findCompletedJob(tenantId, 'payment', paymentId);
    const result = await provider.syncPayment(creds, {
      internalId: pay.id,
      ...(existing?.externalId ? { externalId: existing.externalId } : {}),
      customerExternalId,
      invoiceExternalId,
      amountCents: pay.amountCents,
      currency: invoiceRow.currency,
      paidAt: pay.receivedAt.toISOString(),
      method: pay.paymentMethod,
    });
    await this.touchLastSync(tenantId);
    return result.externalId;
  }

  private async pushRefund(
    tenantId: string,
    paymentId: string,
    provider: AccountingProvider,
    creds: AccountingProviderCredentials,
  ): Promise<string> {
    const pay = await this.admin.runAsAdmin({}, async (db) =>
      db.query.payments.findFirst({ where: eq(payments.id, paymentId) }),
    );
    if (!pay) throw new Error(`payment ${paymentId} not found`);
    if (pay.tenantId !== tenantId) throw new Error('tenant mismatch');

    const invoiceRow = await this.admin.runAsAdmin({}, async (db) =>
      db.query.invoices.findFirst({ where: eq(invoices.id, pay.invoiceId) }),
    );
    if (!invoiceRow?.customerId) throw new Error('invoice has no customer');
    const customerExternalId = await this.pushCustomer(
      tenantId,
      invoiceRow.customerId,
      provider,
      creds,
    );
    // Try to locate the prior payment row this refund offsets via stripe_charge_id.
    let originalPaymentExternalId = '';
    if (pay.stripeChargeId) {
      const original = await this.admin.runAsAdmin({}, async (db) =>
        db.query.payments.findFirst({
          where: and(
            eq(payments.tenantId, tenantId),
            eq(payments.stripeChargeId, pay.stripeChargeId as string),
          ),
        }),
      );
      if (original) {
        const originalJob = await this.findCompletedJob(tenantId, 'payment', original.id);
        if (originalJob?.externalId) originalPaymentExternalId = originalJob.externalId;
      }
    }
    const invoiceExternalId = await this.pushInvoice(tenantId, pay.invoiceId, provider, creds);

    const existing = await this.findCompletedJob(tenantId, 'refund', paymentId);
    const result = await provider.syncRefund(creds, {
      internalId: pay.id,
      ...(existing?.externalId ? { externalId: existing.externalId } : {}),
      customerExternalId,
      invoiceExternalId,
      originalPaymentExternalId,
      amountCents: Math.abs(pay.amountCents),
      currency: invoiceRow.currency,
      refundedAt: pay.receivedAt.toISOString(),
    });
    await this.touchLastSync(tenantId);
    return result.externalId;
  }

  private async findCompletedJob(
    tenantId: string,
    entityType: 'customer' | 'invoice' | 'payment' | 'refund',
    entityId: string,
  ): Promise<{ externalId: string | null } | null> {
    return this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.syncJobs.findFirst({
        where: and(
          eq(syncJobs.tenantId, tenantId),
          eq(syncJobs.provider, this.providerId),
          eq(syncJobs.entityType, entityType),
          eq(syncJobs.entityId, entityId),
          eq(syncJobs.status, 'completed'),
        ),
        orderBy: (j, { desc }) => desc(j.completedAt),
      });
      return row ? { externalId: row.externalId } : null;
    });
  }
}

function toTenantCtx(ctx: CallerContext): {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress ?? undefined,
    userAgent: ctx.userAgent ?? undefined,
  };
}

function requireOwnerOrAdmin(role: string | null, accountingOk = false): void {
  const allowed = role === 'owner' || role === 'admin';
  if (allowed) return;
  if (accountingOk && role === 'accounting') return;
  throw new ForbiddenException({
    code: ERROR_CODES.FORBIDDEN,
    message: 'owner/admin only',
  });
}

function mapEntityType(
  name: 'Customer' | 'Invoice' | 'Payment' | 'RefundReceipt' | 'Item' | 'Account',
): 'customer' | 'invoice' | 'payment' | 'refund' | null {
  switch (name) {
    case 'Customer':
      return 'customer';
    case 'Invoice':
      return 'invoice';
    case 'Payment':
      return 'payment';
    case 'RefundReceipt':
      return 'refund';
    default:
      return null;
  }
}

function rowToMappingDto(row: AccountMapping): AccountMappingDto {
  return {
    internalCategory: row.internalCategory as AccountMappingDto['internalCategory'],
    externalAccountId: row.externalAccountId,
    externalAccountName: row.externalAccountName ?? null,
    externalAccountType: row.externalAccountType ?? null,
  };
}

function rowToSyncJobDto(row: {
  id: string;
  entityType: string;
  entityId: string;
  direction: string;
  status: string;
  externalId: string | null;
  retryCount: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
  nextAttemptAt: Date;
  createdAt: Date;
  completedAt: Date | null;
}): SyncJobDto {
  return {
    id: row.id,
    entityType: row.entityType as SyncJobDto['entityType'],
    entityId: row.entityId,
    direction: row.direction as SyncJobDto['direction'],
    status: row.status as SyncJobDto['status'],
    externalId: row.externalId,
    retryCount: row.retryCount,
    lastAttemptAt: row.lastAttemptAt ? row.lastAttemptAt.toISOString() : null,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
