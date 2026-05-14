import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import { mapValue, normalizeString } from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

@Injectable()
export class TruckImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'truck';
  protected readonly csvKey = 'trucks';

  protected async importRow(
    ctx: ImportContext,
    get: (row: string[], field: string) => string | null,
    row: string[],
  ): Promise<ImportRowOutcome> {
    const externalId = normalizeString(get(row, 'external_id'));
    if (!externalId)
      return { action: 'error', externalId: null, errorMessage: 'missing external_id' };
    const unitNumber = normalizeString(get(row, 'unit_number'));
    const vin = normalizeString(get(row, 'vin'))?.toUpperCase() ?? null;
    const year = parseIntOrNull(get(row, 'year'));
    const make = normalizeString(get(row, 'make'));
    const model = normalizeString(get(row, 'model'));
    const plate = normalizeString(get(row, 'plate'));
    const plateState = normalizeString(get(row, 'plate_state'));
    const gvwr = parseIntOrNull(get(row, 'gvwr'));
    const equipmentType =
      mapValue(ctx.mapping.value_maps, 'equipment_type', get(row, 'equipment_type')) ?? 'flatbed';

    const byExternal = await ctx.client.query<{ id: string }>(
      `SELECT id FROM trucks WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, externalId],
    );
    if (byExternal.rowCount && byExternal.rowCount > 0) {
      const id = byExternal.rows[0]?.id ?? null;
      if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
      await ctx.client.query(
        `UPDATE trucks SET
            unit_number = COALESCE(NULLIF($2, ''), unit_number),
            vin = COALESCE(NULLIF($3, ''), vin),
            year = COALESCE($4, year),
            make = COALESCE(NULLIF($5, ''), make),
            model = COALESCE(NULLIF($6, ''), model),
            plate = COALESCE(NULLIF($7, ''), plate),
            plate_state = COALESCE(NULLIF($8, ''), plate_state),
            gvwr_lbs = COALESCE($9, gvwr_lbs),
            truck_type = COALESCE($10, truck_type),
            updated_at = now()
         WHERE id=$1`,
        [
          id,
          unitNumber ?? '',
          vin ?? '',
          year,
          make ?? '',
          model ?? '',
          plate ?? '',
          plateState ?? '',
          gvwr,
          equipmentType,
        ],
      );
      return { action: 'update', externalId, towcommandId: id };
    }

    if (vin) {
      const byVin = await ctx.client.query<{ id: string }>(
        'SELECT id FROM trucks WHERE tenant_id=$1 AND upper(vin) = $2 LIMIT 1',
        [ctx.tenantId, vin],
      );
      if (byVin.rowCount && byVin.rowCount > 0) {
        const id = byVin.rows[0]?.id ?? null;
        if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
        await ctx.client.query(
          `UPDATE trucks SET external_source='towbook', external_id=$2, updated_at=now() WHERE id=$1`,
          [id, externalId],
        );
        return { action: 'update', externalId, towcommandId: id };
      }
    }
    if (unitNumber) {
      const byUnit = await ctx.client.query<{ id: string }>(
        'SELECT id FROM trucks WHERE tenant_id=$1 AND unit_number=$2 LIMIT 1',
        [ctx.tenantId, unitNumber],
      );
      if (byUnit.rowCount && byUnit.rowCount > 0) {
        const id = byUnit.rows[0]?.id ?? null;
        if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
        await ctx.client.query(
          `UPDATE trucks SET external_source='towbook', external_id=$2, updated_at=now() WHERE id=$1`,
          [id, externalId],
        );
        return { action: 'update', externalId, towcommandId: id };
      }
    }

    const id = uuidv7();
    await ctx.client.query(
      `INSERT INTO trucks (
          id, tenant_id, unit_number, vin, year, make, model,
          plate, plate_state, gvwr_lbs, truck_type, in_service, status,
          external_source, external_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, 'active',
                 'towbook', $12, now(), now())`,
      [
        id,
        ctx.tenantId,
        unitNumber,
        vin,
        year,
        make,
        model,
        plate,
        plateState,
        gvwr,
        equipmentType,
        externalId,
      ],
    );
    return { action: 'create', externalId, towcommandId: id };
  }
}

const parseIntOrNull = (raw: string | null): number | null => {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};
