/**
 * Shared types for the Towbook importer.
 */
import type { PoolClient } from 'pg';

export type ImportRecordType =
  | 'customer'
  | 'vehicle'
  | 'job'
  | 'driver'
  | 'truck'
  | 'impound'
  | 'invoice'
  | 'payment'
  | 'motor_club_history'
  | 'attachment';

export type ImportAction = 'create' | 'update' | 'skip_dedup' | 'error' | 'cancelled';

export type ImportMode = 'dry_run' | 'live' | 'reconcile';

export type ImportStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface ImportContext {
  runId: string;
  tenantId: string;
  userId: string;
  mode: ImportMode;
  /** Database client bound to the active transaction. */
  client: PoolClient;
  /** Column → canonical-field name map. */
  mapping: TowbookMapping;
  /** Set to true when the user cancels — importers should check between rows. */
  shouldCancel: () => boolean;
  /** Records an outcome row for this run. */
  recordEvent: (event: ImportEventInput) => Promise<void>;
}

export interface ImportEventInput {
  recordType: ImportRecordType;
  action: ImportAction;
  externalId?: string | null;
  towcommandId?: string | null;
  errorMessage?: string | null;
}

export interface ImporterResultCounts {
  created: number;
  updated: number;
  skippedDedup: number;
  errored: number;
}

export interface ImportTotals {
  customers?: ImporterResultCounts;
  vehicles?: ImporterResultCounts;
  jobs?: ImporterResultCounts;
  drivers?: ImporterResultCounts;
  trucks?: ImporterResultCounts;
  impounds?: ImporterResultCounts;
  invoices?: ImporterResultCounts;
  payments?: ImporterResultCounts;
  motor_club_history?: ImporterResultCounts;
  attachments?: ImporterResultCounts;
}

export interface TowbookMapping {
  version: string;
  source: string;
  files: Record<string, Record<string, string[]>>;
  value_maps: Record<string, Record<string, string>>;
}

export interface ParsedCsvFile {
  headerMap: Map<string, number>;
  rows: string[][];
}
