import type { Buffer } from 'node:buffer';
/**
 * BaseImporter — common per-record loop with savepoint-every-1000 logic,
 * error capture, and dedup-aware upsert semantics. Subclasses implement
 * `importRow(ctx, getter, row)` and return one of:
 *   - { action: 'create' | 'update', externalId, towcommandId }
 *   - { action: 'skip_dedup', externalId }
 *   - { action: 'error', externalId, errorMessage }
 *
 * The base orchestrator handles savepoints, event recording, and counts.
 */
import { Logger } from '@nestjs/common';
import { BundleService } from '../bundle.service.js';
import type {
  ImportContext,
  ImportRecordType,
  ImporterResultCounts,
  ParsedCsvFile,
} from '../types.js';

export interface ImporterBundle {
  csv: Map<string, ParsedCsvFile>;
  attachments: Map<string, Buffer>;
}

export type ImportRowOutcome =
  | { action: 'create' | 'update'; externalId: string | null; towcommandId: string | null }
  | { action: 'skip_dedup'; externalId: string | null; towcommandId: string | null }
  | { action: 'error'; externalId: string | null; errorMessage: string };

const SAVEPOINT_INTERVAL = 1000;

export abstract class BaseImporter {
  protected readonly logger: Logger;
  protected abstract readonly recordType: ImportRecordType;
  protected abstract readonly csvKey: string;

  constructor(protected readonly bundle: BundleService) {
    this.logger = new Logger(this.constructor.name);
  }

  async run(ctx: ImportContext, b: ImporterBundle): Promise<ImporterResultCounts> {
    const counts: ImporterResultCounts = { created: 0, updated: 0, skippedDedup: 0, errored: 0 };
    const file = b.csv.get(this.csvKey);
    if (!file || file.rows.length === 0) return counts;

    const getter = this.bundle.buildRowGetter(ctx.mapping, this.csvKey, file.headerMap);
    let savepointSeq = 0;
    let savepointActive = false;
    const beginSavepoint = async () => {
      savepointActive = true;
      savepointSeq++;
      await ctx.client.query(`SAVEPOINT sp_${this.csvKey}_${savepointSeq}`);
    };
    const releaseSavepoint = async () => {
      if (savepointActive) {
        await ctx.client.query(`RELEASE SAVEPOINT sp_${this.csvKey}_${savepointSeq}`);
        savepointActive = false;
      }
    };
    const rollbackSavepoint = async () => {
      if (savepointActive) {
        await ctx.client.query(`ROLLBACK TO SAVEPOINT sp_${this.csvKey}_${savepointSeq}`);
        savepointActive = false;
      }
    };

    await beginSavepoint();

    for (let i = 0; i < file.rows.length; i++) {
      if (ctx.shouldCancel()) {
        await rollbackSavepoint();
        return counts;
      }
      const row = file.rows[i]!;
      let outcome: ImportRowOutcome;
      try {
        outcome = await this.importRow(ctx, getter, row);
      } catch (err) {
        outcome = {
          action: 'error',
          externalId: getter(row, 'external_id'),
          errorMessage: (err as Error).message ?? 'unknown error',
        };
        await rollbackSavepoint();
        await beginSavepoint();
      }

      switch (outcome.action) {
        case 'create':
          counts.created++;
          break;
        case 'update':
          counts.updated++;
          break;
        case 'skip_dedup':
          counts.skippedDedup++;
          break;
        case 'error':
          counts.errored++;
          break;
      }

      await ctx.recordEvent({
        recordType: this.recordType,
        action: outcome.action,
        externalId: outcome.action === 'error' ? outcome.externalId : (outcome.externalId ?? null),
        towcommandId: outcome.action === 'error' ? null : outcome.towcommandId,
        errorMessage: outcome.action === 'error' ? outcome.errorMessage : null,
      });

      if ((i + 1) % SAVEPOINT_INTERVAL === 0) {
        await releaseSavepoint();
        await beginSavepoint();
      }
    }

    await releaseSavepoint();
    return counts;
  }

  protected abstract importRow(
    ctx: ImportContext,
    get: (row: string[], canonicalField: string) => string | null,
    row: string[],
  ): Promise<ImportRowOutcome>;
}
