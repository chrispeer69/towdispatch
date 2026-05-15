import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@towcommand/db';
import { BundleService } from '../bundle.service.js';
import {
  dollarsToCents,
  mapValue,
  normalizeString,
  parseTowbookTimestamp,
} from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

@Injectable()
export class JobImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'job';
  protected readonly csvKey = 'calls';

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

    const serviceType =
      mapValue(ctx.mapping.value_maps, 'service_type', get(row, 'service_type')) ?? 'tow';
    const status = mapValue(ctx.mapping.value_maps, 'status', get(row, 'status')) ?? 'completed';
    const pickupAddress =
      normalizeString(get(row, 'pickup_address')) ?? 'Imported (no pickup address)';
    const pickupLat = parseFloatOrNull(get(row, 'pickup_lat'));
    const pickupLng = parseFloatOrNull(get(row, 'pickup_lng'));
    const dropoffAddress = normalizeString(get(row, 'dropoff_address'));
    const dropoffLat = parseFloatOrNull(get(row, 'dropoff_lat'));
    const dropoffLng = parseFloatOrNull(get(row, 'dropoff_lng'));
    const notes = normalizeString(get(row, 'notes'));
    const totalCents = dollarsToCents(get(row, 'total_charged')) ?? 0;
    const commissionCents = dollarsToCents(get(row, 'driver_commission'));
    const callReceivedAt = parseTowbookTimestamp(get(row, 'call_received_at'));
    const assignedAt = parseTowbookTimestamp(get(row, 'assigned_at'));
    const enRouteAt = parseTowbookTimestamp(get(row, 'en_route_at'));
    const onSceneAt = parseTowbookTimestamp(get(row, 'on_scene_at'));
    const inTransitAt = parseTowbookTimestamp(get(row, 'in_transit_at'));
    const droppedAt = parseTowbookTimestamp(get(row, 'dropped_at'));
    const clearedAt = parseTowbookTimestamp(get(row, 'cleared_at'));

    const customerExt = normalizeString(get(row, 'customer_towbook_id'));
    const vehicleExt = normalizeString(get(row, 'vehicle_towbook_id'));
    const driverExt = normalizeString(get(row, 'assigned_driver_towbook_id'));
    const truckExt = normalizeString(get(row, 'assigned_truck_towbook_id'));

    const customerId = customerExt
      ? await this.resolveExternal(ctx, 'customers', customerExt)
      : null;
    const vehicleId = vehicleExt ? await this.resolveExternal(ctx, 'vehicles', vehicleExt) : null;
    const driverId = driverExt ? await this.resolveExternal(ctx, 'drivers', driverExt) : null;
    const truckId = truckExt ? await this.resolveExternal(ctx, 'trucks', truckExt) : null;

    if (customerExt && !customerId) {
      return { action: 'error', externalId, errorMessage: `unresolved customer ${customerExt}` };
    }
    if (vehicleExt && !vehicleId) {
      return { action: 'error', externalId, errorMessage: `unresolved vehicle ${vehicleExt}` };
    }

    const byExternal = await ctx.client.query<{ id: string }>(
      `SELECT id FROM jobs WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, externalId],
    );
    if (byExternal.rowCount && byExternal.rowCount > 0) {
      const id = byExternal.rows[0]?.id ?? null;
      if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
      await ctx.client.query(
        `UPDATE jobs SET
            status = $2,
            service_type = $3,
            pickup_address = $4,
            pickup_lat = COALESCE($5::text, pickup_lat),
            pickup_lng = COALESCE($6::text, pickup_lng),
            dropoff_address = COALESCE(NULLIF($7, ''), dropoff_address),
            dropoff_lat = COALESCE($8::text, dropoff_lat),
            dropoff_lng = COALESCE($9::text, dropoff_lng),
            customer_id = COALESCE($10, customer_id),
            vehicle_id = COALESCE($11, vehicle_id),
            assigned_driver_id = COALESCE($12, assigned_driver_id),
            assigned_truck_id = COALESCE($13, assigned_truck_id),
            rate_quoted_cents = COALESCE($14, rate_quoted_cents),
            notes = COALESCE(NULLIF($15, ''), notes),
            updated_at = now()
         WHERE id=$1`,
        [
          id,
          status,
          serviceType,
          pickupAddress,
          pickupLat === null ? null : String(pickupLat),
          pickupLng === null ? null : String(pickupLng),
          dropoffAddress ?? '',
          dropoffLat === null ? null : String(dropoffLat),
          dropoffLng === null ? null : String(dropoffLng),
          customerId,
          vehicleId,
          driverId,
          truckId,
          totalCents,
          notes ?? '',
        ],
      );
      return { action: 'update', externalId, towcommandId: id };
    }

    const id = uuidv7();
    const jobNumber = await this.allocateJobNumber(ctx, callReceivedAt ?? new Date().toISOString());

    // jobs has only an assigned_at timestamp column; the rest of the
    // lifecycle is captured in job_status_transitions, which we'll backfill
    // for cleared imports in a follow-up. Imported jobs land with their
    // final status and assignedAt; the intermediate timestamps would
    // require synthesising a transition history that doesn't change
    // operational behavior today.
    void enRouteAt;
    void onSceneAt;
    void inTransitAt;
    void droppedAt;
    void clearedAt;
    await ctx.client.query(
      `INSERT INTO jobs (
          id, tenant_id, job_number, status, service_type,
          customer_id, vehicle_id, assigned_driver_id, assigned_truck_id,
          pickup_address, pickup_lat, pickup_lng,
          dropoff_address, dropoff_lat, dropoff_lng,
          authorized_by, rate_quoted_cents, notes,
          assigned_at, created_at, updated_at,
          external_source, external_id
       ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11::text, $12::text,
          $13, $14::text, $15::text,
          'customer', $16, $17,
          $18, COALESCE($19, now()), now(),
          'towbook', $20
       )`,
      [
        id,
        ctx.tenantId,
        jobNumber,
        status,
        serviceType,
        customerId,
        vehicleId,
        driverId,
        truckId,
        pickupAddress,
        pickupLat === null ? null : String(pickupLat),
        pickupLng === null ? null : String(pickupLng),
        dropoffAddress,
        dropoffLat === null ? null : String(dropoffLat),
        dropoffLng === null ? null : String(dropoffLng),
        totalCents,
        notes,
        assignedAt,
        callReceivedAt,
        externalId,
      ],
    );
    return { action: 'create', externalId, towcommandId: id };
  }

  private async resolveExternal(
    ctx: ImportContext,
    table: 'customers' | 'vehicles' | 'drivers' | 'trucks',
    externalId: string,
  ): Promise<string | null> {
    const r = await ctx.client.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, externalId],
    );
    return r.rowCount && r.rowCount > 0 ? (r.rows[0]?.id ?? null) : null;
  }

  private async allocateJobNumber(ctx: ImportContext, isoTimestamp: string): Promise<string> {
    const day = isoTimestamp.slice(0, 10).replace(/-/g, '');
    // job_number_sequences PK is (tenant_id, day_key) per schema; the column
    // is day_key, not day. updated_at must be bumped on conflict so the
    // not-null timestamp stays current.
    const r = await ctx.client.query<{ next_seq: number }>(
      `INSERT INTO job_number_sequences (tenant_id, day_key, last_seq, updated_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (tenant_id, day_key)
       DO UPDATE SET last_seq = job_number_sequences.last_seq + 1,
                     updated_at = now()
       RETURNING last_seq AS next_seq`,
      [ctx.tenantId, day],
    );
    const seq = r.rows[0]?.next_seq;
    return `${day}-${String(seq).padStart(4, '0')}`;
  }
}

const parseFloatOrNull = (raw: string | null): number | null => {
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
};
