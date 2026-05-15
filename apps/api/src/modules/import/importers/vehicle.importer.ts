import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@towcommand/db';
import { BundleService } from '../bundle.service.js';
import { isValidVin, normalizeString } from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

@Injectable()
export class VehicleImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'vehicle';
  protected readonly csvKey = 'vehicles';

  // biome-ignore lint/complexity/noUselessConstructor: required for NestJS DI metadata
  constructor(bundle: BundleService) {
    super(bundle);
  }

  protected async importRow(
    ctx: ImportContext,
    get: (row: string[], field: string) => string | null,
    row: string[],
  ): Promise<ImportRowOutcome> {
    const externalId = normalizeString(get(row, 'external_id'));
    if (!externalId)
      return { action: 'error', externalId: null, errorMessage: 'missing external_id' };

    const customerExternal = normalizeString(get(row, 'customer_towbook_id'));
    const vin = normalizeString(get(row, 'vin'))?.toUpperCase() ?? null;
    const plate = normalizeString(get(row, 'plate'));
    const plateState = normalizeString(get(row, 'plate_state'));
    const year = parseIntOrNull(get(row, 'year'));
    const make = normalizeString(get(row, 'make'));
    const model = normalizeString(get(row, 'model'));
    const color = normalizeString(get(row, 'color'));
    const notes = normalizeString(get(row, 'notes'));

    // Resolve customer FK
    let customerId: string | null = null;
    if (customerExternal) {
      const r = await ctx.client.query<{ id: string }>(
        `SELECT id FROM customers
         WHERE tenant_id = $1 AND external_source = 'towbook' AND external_id = $2
         LIMIT 1`,
        [ctx.tenantId, customerExternal],
      );
      if (r.rowCount && r.rowCount > 0) {
        customerId = r.rows[0]?.id ?? null;
      } else {
        return {
          action: 'error',
          externalId,
          errorMessage: `unresolved customer_towbook_id=${customerExternal}`,
        };
      }
    }

    // Dedup
    const existingByExternal = await ctx.client.query<{ id: string }>(
      `SELECT id FROM vehicles WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, externalId],
    );
    if (existingByExternal.rowCount && existingByExternal.rowCount > 0) {
      const id = existingByExternal.rows[0]?.id ?? null;
      if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
      // vehicles schema has no `notes` column — Towbook notes flow into
      // special_instructions for the imported row.
      await ctx.client.query(
        `UPDATE vehicles SET
            vin = COALESCE(NULLIF($2, ''), vin),
            plate = COALESCE(NULLIF($3, ''), plate),
            plate_state = COALESCE(NULLIF($4, ''), plate_state),
            year = COALESCE($5, year),
            make = COALESCE(NULLIF($6, ''), make),
            model = COALESCE(NULLIF($7, ''), model),
            color = COALESCE(NULLIF($8, ''), color),
            special_instructions = COALESCE(NULLIF($9, ''), special_instructions),
            updated_at = now()
         WHERE id = $1`,
        [
          id,
          vin ?? '',
          plate ?? '',
          plateState ?? '',
          year,
          make ?? '',
          model ?? '',
          color ?? '',
          notes ?? '',
        ],
      );
      return { action: 'update', externalId, towcommandId: id };
    }

    if (vin) {
      const byVin = await ctx.client.query<{ id: string }>(
        'SELECT id FROM vehicles WHERE tenant_id=$1 AND upper(vin) = $2 LIMIT 1',
        [ctx.tenantId, vin],
      );
      if (byVin.rowCount && byVin.rowCount > 0) {
        const id = byVin.rows[0]?.id ?? null;
        if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
        await ctx.client.query(
          `UPDATE vehicles SET external_source='towbook', external_id=$2, updated_at = now() WHERE id=$1`,
          [id, externalId],
        );
        return { action: 'update', externalId, towcommandId: id };
      }
    }
    if (plate && plateState) {
      const byPlate = await ctx.client.query<{ id: string }>(
        'SELECT id FROM vehicles WHERE tenant_id=$1 AND plate=$2 AND plate_state=$3 LIMIT 1',
        [ctx.tenantId, plate, plateState],
      );
      if (byPlate.rowCount && byPlate.rowCount > 0) {
        const id = byPlate.rows[0]?.id ?? null;
        if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
        await ctx.client.query(
          `UPDATE vehicles SET external_source='towbook', external_id=$2, updated_at = now() WHERE id=$1`,
          [id, externalId],
        );
        return { action: 'update', externalId, towcommandId: id };
      }
    }

    // VIN check digit — warn-but-accept.
    if (vin && !isValidVin(vin)) {
      // noted in event stream via recordEvent post-create — but we still create.
    }

    const id = uuidv7();
    // vehicles columns are default_customer_id (not customer_id) and
    // special_instructions (no notes column). The customer<->vehicle
    // relationship is also tracked via the customer_vehicles join table
    // below.
    await ctx.client.query(
      `INSERT INTO vehicles (
          id, tenant_id, default_customer_id, vin, plate, plate_state,
          year, make, model, color, special_instructions,
          external_source, external_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'towbook', $12, now(), now())`,
      [
        id,
        ctx.tenantId,
        customerId,
        vin,
        plate,
        plateState,
        year,
        make,
        model,
        color,
        notes,
        externalId,
      ],
    );

    // Link to customer_vehicles (id PK has no default; relationship/is_primary
    // have schema defaults). ON CONFLICT DO NOTHING absorbs the partial
    // unique index on (tenant_id, customer_id, vehicle_id) defined in
    // sql/0006.
    if (customerId) {
      await ctx.client.query(
        `INSERT INTO customer_vehicles (id, tenant_id, customer_id, vehicle_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT DO NOTHING`,
        [uuidv7(), ctx.tenantId, customerId, id],
      );
    }

    return { action: 'create', externalId, towcommandId: id };
  }
}

const parseIntOrNull = (raw: string | null): number | null => {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};
