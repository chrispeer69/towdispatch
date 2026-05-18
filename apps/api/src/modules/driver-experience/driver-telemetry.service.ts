/**
 * DriverTelemetryService — high-frequency GPS / status pings from the
 * in-truck app.
 *
 * Hot path. Must be the cheapest endpoint in the API:
 *   - single INSERT, no joins, no audit log (the table has no audit
 *     trigger by design)
 *   - the `gps_ping` flavor also updates the driver's active shift's
 *     last_lat/last_lng/last_position_at so the dispatch board's
 *     read-side cache stays fresh — this update + the insert run in
 *     the same transaction so a power-cycled phone never lands a ping
 *     without a corresponding shift refresh, and vice versa.
 *
 * Batch endpoint: accepts up to N events at once (the shared zod
 * schema caps at 500). Used by the offline-sync queue when service
 * returns. Inserts in chronological order; the shift-cache update
 * runs exactly once (on the latest event) to avoid redundant writes
 * to driver_shifts in the same transaction.
 */
import { Injectable } from '@nestjs/common';
import { driverShifts, driverTelemetryEvents, uuidv7 } from '@ustowdispatch/db';
import {
  type CreateDriverTelemetryBatchPayload,
  type CreateDriverTelemetryEventPayload,
  type DriverTelemetryEventDto,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import type { DriverContext } from './driver-auth.service.js';

@Injectable()
export class DriverTelemetryService {
  constructor(private readonly db: TenantAwareDb) {}

  async ping(
    ctx: DriverContext,
    input: CreateDriverTelemetryEventPayload,
  ): Promise<DriverTelemetryEventDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        const row = await insertTelemetry(tx, ctx, input);
        await maybeUpdateShiftCache(tx, ctx.driverId, input);
        return rowToDto(row);
      },
    );
  }

  async pingBatch(
    ctx: DriverContext,
    input: CreateDriverTelemetryBatchPayload,
  ): Promise<{ inserted: number }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        // Sort chronologically so the shift cache update uses the
        // freshest position. Clients should send in order but we don't
        // trust them — a phone that recovered from sleep might queue
        // out-of-order writes.
        const sorted = [...input.events].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
        for (const ev of sorted) {
          await insertTelemetry(tx, ctx, ev);
        }
        const last = sorted[sorted.length - 1];
        if (last) await maybeUpdateShiftCache(tx, ctx.driverId, last);
        return { inserted: sorted.length };
      },
    );
  }
}

async function insertTelemetry(
  tx: Tx,
  ctx: DriverContext,
  ev: CreateDriverTelemetryEventPayload,
): Promise<typeof driverTelemetryEvents.$inferSelect> {
  const id = uuidv7();
  const [row] = await tx
    .insert(driverTelemetryEvents)
    .values({
      id,
      tenantId: ctx.tenantId,
      driverId: ctx.driverId,
      shiftId: ev.shiftId ?? null,
      jobId: ev.jobId ?? null,
      recordedAt: new Date(ev.recordedAt),
      lat: ev.lat !== undefined ? String(ev.lat) : null,
      lng: ev.lng !== undefined ? String(ev.lng) : null,
      speedMph: ev.speedMph !== undefined ? String(ev.speedMph) : null,
      headingDegrees: ev.headingDegrees !== undefined ? String(ev.headingDegrees) : null,
      accuracyMeters: ev.accuracyMeters !== undefined ? String(ev.accuracyMeters) : null,
      batteryPct: ev.batteryPct ?? null,
      eventKind: ev.eventKind,
      payload: ev.payload ?? null,
    })
    .returning();
  if (!row) throw new Error('insert driver_telemetry_events .. yielded no row');
  return row;
}

/**
 * Update driver_shifts.last_lat/last_lng/last_position_at when this
 * event is a `ping` carrying a coordinate AND the driver has an open
 * shift. Cheap WHERE filter — at-most-one row is matched (the partial
 * unique index on (tenant_id, driver_id) WHERE ended_at IS NULL
 * already guarantees uniqueness).
 */
async function maybeUpdateShiftCache(
  tx: Tx,
  driverId: string,
  ev: CreateDriverTelemetryEventPayload,
): Promise<void> {
  if (ev.eventKind !== 'ping') return;
  if (ev.lat === undefined || ev.lng === undefined) return;
  await tx
    .update(driverShifts)
    .set({
      lastLat: String(ev.lat),
      lastLng: String(ev.lng),
      lastPositionAt: new Date(ev.recordedAt),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(driverShifts.driverId, driverId),
        isNull(driverShifts.endedAt),
        isNull(driverShifts.deletedAt),
      ),
    );
}

function rowToDto(r: typeof driverTelemetryEvents.$inferSelect): DriverTelemetryEventDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    driverId: r.driverId,
    shiftId: r.shiftId,
    jobId: r.jobId,
    recordedAt: r.recordedAt.toISOString(),
    lat: r.lat !== null ? Number(r.lat) : null,
    lng: r.lng !== null ? Number(r.lng) : null,
    speedMph: r.speedMph !== null ? Number(r.speedMph) : null,
    headingDegrees: r.headingDegrees !== null ? Number(r.headingDegrees) : null,
    accuracyMeters: r.accuracyMeters !== null ? Number(r.accuracyMeters) : null,
    batteryPct: r.batteryPct,
    eventKind: r.eventKind,
    payload: (r.payload as Record<string, unknown> | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
