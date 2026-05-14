import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import { dollarsToCents, normalizeString, parseTowbookTimestamp } from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

/**
 * No `impounds` table exists in this repo at the time of writing — impounds
 * are modeled as a `service_type='impound'` job plus structured metadata in
 * `jobs.notes` (JSON). This importer creates the job row and records the
 * impound-specific fields as a JSON blob in notes so reconciliation can read
 * them back. When the impounds table lands in a future session, swap the
 * INSERT target — the external_id idempotency carries over.
 */
@Injectable()
export class ImpoundImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'impound';
  protected readonly csvKey = 'impounds';

  protected async importRow(
    ctx: ImportContext,
    get: (row: string[], field: string) => string | null,
    row: string[],
  ): Promise<ImportRowOutcome> {
    const externalId = normalizeString(get(row, 'external_id'));
    if (!externalId)
      return { action: 'error', externalId: null, errorMessage: 'missing external_id' };

    const vehicleExt = normalizeString(get(row, 'vehicle_towbook_id'));
    const impoundDate = parseTowbookTimestamp(get(row, 'impound_date'));
    const yardName = normalizeString(get(row, 'yard_name'));
    const holdType = normalizeString(get(row, 'hold_type'));
    const dailyRate = dollarsToCents(get(row, 'daily_rate'));
    const releaseDate = parseTowbookTimestamp(get(row, 'release_date'));
    const releaseReason = normalizeString(get(row, 'release_reason'));
    const inventory = normalizeString(get(row, 'personal_property_inventory'));

    // Resolve vehicle
    let vehicleId: string | null = null;
    if (vehicleExt) {
      const r = await ctx.client.query<{ id: string }>(
        `SELECT id FROM vehicles WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
        [ctx.tenantId, vehicleExt],
      );
      if (r.rowCount && r.rowCount > 0) vehicleId = r.rows[0]?.id ?? null;
      else return { action: 'error', externalId, errorMessage: `unresolved vehicle ${vehicleExt}` };
    }

    const dedup = await ctx.client.query<{ id: string }>(
      `SELECT id FROM jobs WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, `impound:${externalId}`],
    );
    if (dedup.rowCount && dedup.rowCount > 0) {
      return { action: 'skip_dedup', externalId, towcommandId: dedup.rows[0]?.id ?? null };
    }

    const id = uuidv7();
    const jobNumber = await this.allocateJobNumber(
      ctx,
      impoundDate ?? new Date().toISOString(),
      'IMP',
    );
    const notesJson = JSON.stringify({
      kind: 'impound',
      yard_name: yardName,
      hold_type: holdType,
      daily_rate_cents: dailyRate,
      release_date: releaseDate,
      release_reason: releaseReason,
      personal_property_inventory: inventory,
    });

    await ctx.client.query(
      `INSERT INTO jobs (
          id, tenant_id, job_number, status, service_type,
          vehicle_id, pickup_address, authorized_by, rate_quoted_cents, notes,
          completed_at, created_at, updated_at,
          external_source, external_id
       ) VALUES (
          $1, $2, $3, $4, 'impound',
          $5, $6, 'police', 0, $7,
          $8, COALESCE($9, now()), now(),
          'towbook', $10
       )`,
      [
        id,
        ctx.tenantId,
        jobNumber,
        releaseDate ? 'completed' : 'in_progress',
        vehicleId,
        yardName ?? 'Impound Yard',
        notesJson,
        releaseDate,
        impoundDate,
        `impound:${externalId}`,
      ],
    );
    return { action: 'create', externalId, towcommandId: id };
  }

  private async allocateJobNumber(
    ctx: ImportContext,
    iso: string,
    prefix: string,
  ): Promise<string> {
    const day = iso.slice(0, 10).replace(/-/g, '');
    const r = await ctx.client.query<{ next_seq: number }>(
      `INSERT INTO job_number_sequences (tenant_id, day, last_seq)
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, day)
       DO UPDATE SET last_seq = job_number_sequences.last_seq + 1
       RETURNING last_seq AS next_seq`,
      [ctx.tenantId, day],
    );
    const seq = r.rows[0]?.next_seq;
    return `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
  }
}
