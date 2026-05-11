/**
 * Accounting integration — Session 12 wire contracts.
 *
 * DTOs/payloads consumed by the /accounting/settings + /accounting/mapping
 * web pages. The web client never speaks to QuickBooks directly — every flow
 * routes through the API.
 */
import { z } from 'zod';

export const accountingProviderIdValues = ['quickbooks-online', 'quickbooks-online-stub'] as const;
export type AccountingProviderIdDto = (typeof accountingProviderIdValues)[number];

export const accountingConnectionStatusDtoValues = [
  'pending',
  'connected',
  'disconnected',
  'error',
] as const;
export type AccountingConnectionStatusDto = (typeof accountingConnectionStatusDtoValues)[number];

export const accountingConnectStatusDtoSchema = z.object({
  configured: z.boolean(),
  provider: z.enum(accountingProviderIdValues),
  sandbox: z.boolean(),
  connection: z
    .object({
      status: z.enum(accountingConnectionStatusDtoValues),
      realmId: z.string().nullable(),
      connectedAt: z.string().datetime().nullable(),
      disconnectedAt: z.string().datetime().nullable(),
      lastSyncAt: z.string().datetime().nullable(),
      lastSyncError: z.string().nullable(),
    })
    .nullable(),
});
export type AccountingConnectStatusDto = z.infer<typeof accountingConnectStatusDtoSchema>;

export const accountingConnectStartResponseSchema = z.object({
  authorizationUrl: z.string().url(),
  state: z.string(),
});
export type AccountingConnectStartResponse = z.infer<typeof accountingConnectStartResponseSchema>;

export const accountingConnectCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  realmId: z.string().min(1),
});
export type AccountingConnectCallbackQuery = z.infer<typeof accountingConnectCallbackQuerySchema>;

export const accountingDisconnectResponseSchema = z.object({
  disconnected: z.boolean(),
});
export type AccountingDisconnectResponse = z.infer<typeof accountingDisconnectResponseSchema>;

// ---------- Chart of accounts ----------

export const chartOfAccountDtoSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  type: z.string(),
  subType: z.string().optional(),
  active: z.boolean(),
});
export type ChartOfAccountDto = z.infer<typeof chartOfAccountDtoSchema>;

export const chartOfAccountsResponseSchema = z.object({
  provider: z.enum(accountingProviderIdValues),
  accounts: z.array(chartOfAccountDtoSchema),
});
export type ChartOfAccountsResponse = z.infer<typeof chartOfAccountsResponseSchema>;

// ---------- Account mapping ----------

export const accountMappingInternalCategoryDtoValues = [
  'service_revenue',
  'mileage_revenue',
  'wait_time_revenue',
  'storage_revenue',
  'recovery_revenue',
  'admin_fee_revenue',
  'tax_payable',
  'discounts',
  'platform_fees',
  'stripe_fees',
  'cash_clearing',
  'undeposited_funds',
  'accounts_receivable',
  'refunds',
] as const;
export type AccountMappingInternalCategoryDto =
  (typeof accountMappingInternalCategoryDtoValues)[number];

export const accountMappingDtoSchema = z.object({
  internalCategory: z.enum(accountMappingInternalCategoryDtoValues),
  externalAccountId: z.string(),
  externalAccountName: z.string().nullable(),
  externalAccountType: z.string().nullable(),
});
export type AccountMappingDto = z.infer<typeof accountMappingDtoSchema>;

export const accountMappingsResponseSchema = z.object({
  provider: z.enum(accountingProviderIdValues),
  mappings: z.array(accountMappingDtoSchema),
});
export type AccountMappingsResponse = z.infer<typeof accountMappingsResponseSchema>;

export const updateAccountMappingSchema = z.object({
  internalCategory: z.enum(accountMappingInternalCategoryDtoValues),
  externalAccountId: z.string().min(1),
  externalAccountName: z.string().optional(),
  externalAccountType: z.string().optional(),
});
export type UpdateAccountMappingPayload = z.infer<typeof updateAccountMappingSchema>;

// ---------- Sync status ----------

export const syncJobStatusDtoValues = [
  'pending',
  'processing',
  'completed',
  'failed',
  'dead_letter',
] as const;
export type SyncJobStatusDto = (typeof syncJobStatusDtoValues)[number];

export const syncJobEntityTypeDtoValues = ['customer', 'invoice', 'payment', 'refund'] as const;
export type SyncJobEntityTypeDto = (typeof syncJobEntityTypeDtoValues)[number];

export const syncJobDtoSchema = z.object({
  id: z.string().uuid(),
  entityType: z.enum(syncJobEntityTypeDtoValues),
  entityId: z.string().uuid(),
  direction: z.enum(['push', 'pull']),
  status: z.enum(syncJobStatusDtoValues),
  externalId: z.string().nullable(),
  retryCount: z.number().int().nonnegative(),
  lastAttemptAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type SyncJobDto = z.infer<typeof syncJobDtoSchema>;

export const syncStatusResponseSchema = z.object({
  totals: z.object({
    pending: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    deadLetter: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  }),
  recent: z.array(syncJobDtoSchema),
});
export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>;

export const manualSyncPayloadSchema = z.object({
  entityType: z.enum(syncJobEntityTypeDtoValues),
  entityId: z.string().uuid(),
});
export type ManualSyncPayload = z.infer<typeof manualSyncPayloadSchema>;

export const manualSyncResponseSchema = z.object({
  enqueued: z.boolean(),
  jobId: z.string().uuid().nullable(),
});
export type ManualSyncResponse = z.infer<typeof manualSyncResponseSchema>;

export const retrySyncResponseSchema = z.object({
  retried: z.boolean(),
  jobId: z.string().uuid().nullable(),
});
export type RetrySyncResponse = z.infer<typeof retrySyncResponseSchema>;
