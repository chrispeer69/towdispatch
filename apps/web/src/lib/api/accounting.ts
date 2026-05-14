/**
 * Server-side fetchers for the accounting module — same pattern as
 * lib/api/payments.ts. apiServer keeps the access cookie server-side.
 */
import type {
  AccountMappingsResponse,
  AccountingConnectStartResponse,
  AccountingConnectStatusDto,
  AccountingDisconnectResponse,
  ChartOfAccountsResponse,
  ManualSyncResponse,
  RetrySyncResponse,
  SyncStatusResponse,
  UpdateAccountMappingPayload,
} from '@ustowdispatch/shared';
import { apiServer } from './client';

export async function fetchAccountingStatus(): Promise<AccountingConnectStatusDto> {
  return apiServer<AccountingConnectStatusDto>('/accounting/connect/status');
}

export async function startAccountingConnect(): Promise<AccountingConnectStartResponse> {
  return apiServer('/accounting/connect/start', { method: 'POST' });
}

export async function disconnectAccounting(): Promise<AccountingDisconnectResponse> {
  return apiServer('/accounting/connect/disconnect', { method: 'POST' });
}

export async function fetchChartOfAccounts(): Promise<ChartOfAccountsResponse> {
  return apiServer<ChartOfAccountsResponse>('/accounting/chart-of-accounts');
}

export async function fetchAccountMappings(): Promise<AccountMappingsResponse> {
  return apiServer<AccountMappingsResponse>('/accounting/account-mapping');
}

export async function upsertAccountMapping(payload: UpdateAccountMappingPayload): Promise<unknown> {
  return apiServer('/accounting/account-mapping', { method: 'PUT', body: payload });
}

export async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  return apiServer<SyncStatusResponse>('/accounting/sync-status');
}

export async function manualSync(
  entityType: 'customer' | 'invoice' | 'payment' | 'refund',
  entityId: string,
): Promise<ManualSyncResponse> {
  return apiServer('/accounting/sync/manual', {
    method: 'POST',
    body: { entityType, entityId },
  });
}

export async function retrySync(
  entityType: 'customer' | 'invoice' | 'payment' | 'refund',
  entityId: string,
): Promise<RetrySyncResponse> {
  return apiServer(`/accounting/sync/retry/${entityType}/${entityId}`, { method: 'POST' });
}
