import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@towcommand/db';
import { dollarsToCents, mapValue, normalizeString } from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

@Injectable()
export class MotorClubHistoryImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'motor_club_history';
  protected readonly csvKey = 'motor_club_history';

  protected async importRow(
    ctx: ImportContext,
    get: (row: string[], field: string) => string | null,
    row: string[],
  ): Promise<ImportRowOutcome> {
    const jobExt = normalizeString(get(row, 'job_towbook_id'));
    const networkRaw = normalizeString(get(row, 'network'));
    if (!jobExt) return { action: 'error', externalId: null, errorMessage: 'missing job ref' };
    if (!networkRaw)
      return { action: 'error', externalId: jobExt, errorMessage: 'missing network' };

    const network = mapValue(ctx.mapping.value_maps, 'network', networkRaw) ?? 'other';
    const caseId = normalizeString(get(row, 'network_case_id'));
    const partialFee = dollarsToCents(get(row, 'partial_fee_amount'));
    const partialReason = normalizeString(get(row, 'partial_fee_reason'));

    const jobR = await ctx.client.query<{ id: string }>(
      `SELECT id FROM jobs WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, jobExt],
    );
    if (jobR.rowCount === 0) {
      return { action: 'error', externalId: jobExt, errorMessage: `unresolved job ${jobExt}` };
    }
    const jobId = jobR.rows[0]?.id;

    // Idempotency: (job_id, network, network_external_id) is the unique tuple.
    const dedup = await ctx.client.query<{ id: string }>(
      `SELECT id FROM motor_club_dispatches
       WHERE tenant_id=$1 AND job_id=$2 AND network=$3
         AND COALESCE(network_external_id, '') = COALESCE($4, '')
       LIMIT 1`,
      [ctx.tenantId, jobId, network, caseId],
    );
    if (dedup.rowCount && dedup.rowCount > 0) {
      const id = dedup.rows[0]?.id;
      return { action: 'skip_dedup', externalId: caseId ?? jobExt, towcommandId: id };
    }

    const id = uuidv7();
    await ctx.client.query(
      `INSERT INTO motor_club_dispatches (
          id, tenant_id, job_id, network, network_external_id,
          partial_fee_cents, partial_fee_reason, imported,
          external_source, external_id, created_at, updated_at
       ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, true,
          'towbook', $8, now(), now()
       )`,
      [id, ctx.tenantId, jobId, network, caseId, partialFee, partialReason, `${jobExt}:${network}`],
    );
    return { action: 'create', externalId: caseId ?? jobExt, towcommandId: id };
  }
}
