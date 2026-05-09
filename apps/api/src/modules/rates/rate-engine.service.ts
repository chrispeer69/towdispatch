/**
 * RateEngineService — turns intake context into a RateQuote.
 *
 * Resolution order for the rate sheet:
 *   1. accountId is provided AND that account has default_rate_sheet_id set
 *      → use that sheet (source: 'account').
 *   2. tenant_default_rate_sheets has a row for the caller's tenant → use it
 *      (source: 'tenant_default').
 *   3. Hard-coded fallback (light tow, no surcharges). Returns source:
 *      'fallback' so the caller can warn that pricing was estimated.
 *
 * Distance:
 *   - For tow / impound / recovery (anything with a dropoff), we compute the
 *     haversine distance between pickup and dropoff in miles. v1 ships
 *     without geocoding, so we accept lat/lng inputs as numbers; missing
 *     coords yield a zero-distance trace entry.
 *
 * Time-of-day surcharge:
 *   - The supplied scheduledAt (or now()) is interpreted in UTC. This is a
 *     known shortcut for v1 — Session 5+ will pass the tenant's IANA tz.
 *     We log the assumption in the calculation_trace so it's discoverable.
 *
 * Money:
 *   - Everything is integer cents. We never round inside the engine; rounding
 *     happens once at the line-item boundary.
 */
import { Injectable } from '@nestjs/common';
import { accounts, rateSheets, tenantDefaultRateSheets } from '@towcommand/db';
import {
  type JobServiceType,
  type RateLineItem,
  type RateQuote,
  type RateSheetDefinition,
  type SurchargeWindow,
  type VehicleClass,
  rateSheetDefinitionSchema,
} from '@towcommand/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

export interface QuoteInput {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  serviceType: JobServiceType;
  vehicleClass: VehicleClass;
  pickupLat?: number | null | undefined;
  pickupLng?: number | null | undefined;
  dropoffLat?: number | null | undefined;
  dropoffLng?: number | null | undefined;
  scheduledAt?: Date | undefined;
  accountId?: string | null | undefined;
}

const FALLBACK_DEFINITION: RateSheetDefinition = {
  version: 1,
  currency: 'USD',
  freeMilesIncluded: 0,
  services: [
    {
      serviceType: 'tow',
      baseCents: 9500,
      perMileCentsByClass: {
        light_duty: 450,
        medium_duty: 700,
        heavy_duty: 1100,
        motorcycle: 450,
        commercial: 900,
        rv: 800,
        unknown: 450,
      },
      flatFeesByClass: {},
    },
    { serviceType: 'jump_start', baseCents: 7500, perMileCentsByClass: {}, flatFeesByClass: {} },
    { serviceType: 'lockout', baseCents: 6500, perMileCentsByClass: {}, flatFeesByClass: {} },
    { serviceType: 'tire_change', baseCents: 8500, perMileCentsByClass: {}, flatFeesByClass: {} },
    { serviceType: 'fuel', baseCents: 7500, perMileCentsByClass: {}, flatFeesByClass: {} },
    { serviceType: 'winch', baseCents: 15000, perMileCentsByClass: {}, flatFeesByClass: {} },
    {
      serviceType: 'recovery',
      baseCents: 25000,
      perMileCentsByClass: {
        light_duty: 600,
        medium_duty: 900,
        heavy_duty: 1500,
        motorcycle: 600,
        commercial: 1200,
        rv: 1200,
        unknown: 600,
      },
      flatFeesByClass: {},
    },
    {
      serviceType: 'impound',
      baseCents: 12500,
      perMileCentsByClass: {
        light_duty: 450,
        medium_duty: 700,
        heavy_duty: 1100,
        motorcycle: 450,
        commercial: 900,
        rv: 800,
        unknown: 450,
      },
      flatFeesByClass: {},
    },
    { serviceType: 'other', baseCents: 10000, perMileCentsByClass: {}, flatFeesByClass: {} },
  ],
  surcharges: [],
  fixedLineItems: [],
};

@Injectable()
export class RateEngineService {
  constructor(private readonly db: TenantAwareDb) {}

  /**
   * Public quote() entry point.
   *
   * Always returns a RateQuote. The engine never throws on missing data —
   * it falls back to the hard-coded definition and notes the choice in
   * `calculationTrace`. This means the call-intake live preview can keep
   * rendering even when the dispatcher has only typed half the form.
   */
  async quote(input: QuoteInput): Promise<RateQuote> {
    return this.db.runInTenantContext(
      {
        tenantId: input.tenantId,
        userId: input.userId,
        requestId: input.requestId,
        ipAddress: input.ipAddress ?? undefined,
        userAgent: input.userAgent ?? undefined,
      },
      async (tx) => {
        const trace: string[] = [];

        // Step 1: pick a rate sheet.
        let resolvedId: string | null = null;
        let resolvedName: string | null = null;
        let resolvedDefinition: RateSheetDefinition | null = null;
        let source: RateQuote['source'] = 'fallback';

        if (input.accountId) {
          const acct = await tx.query.accounts.findFirst({
            where: and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)),
            columns: { id: true, defaultRateSheetId: true },
          });
          if (acct?.defaultRateSheetId) {
            const sheet = await tx.query.rateSheets.findFirst({
              where: and(
                eq(rateSheets.id, acct.defaultRateSheetId),
                isNull(rateSheets.deletedAt),
              ),
            });
            if (sheet) {
              const parsed = rateSheetDefinitionSchema.safeParse(sheet.definition);
              if (parsed.success) {
                resolvedId = sheet.id;
                resolvedName = sheet.name;
                resolvedDefinition = parsed.data;
                source = 'account';
                trace.push(`Used account rate sheet "${sheet.name}" (${sheet.id}).`);
              } else {
                trace.push(
                  `Account rate sheet ${sheet.id} failed schema validation; falling back.`,
                );
              }
            } else {
              trace.push(`Account default rate sheet ${acct.defaultRateSheetId} not found.`);
            }
          } else {
            trace.push(`Account ${input.accountId} has no default rate sheet; falling back.`);
          }
        }

        if (!resolvedDefinition) {
          const tdrs = await tx.query.tenantDefaultRateSheets.findFirst({
            where: eq(tenantDefaultRateSheets.tenantId, input.tenantId),
          });
          if (tdrs) {
            const sheet = await tx.query.rateSheets.findFirst({
              where: and(eq(rateSheets.id, tdrs.rateSheetId), isNull(rateSheets.deletedAt)),
            });
            if (sheet) {
              const parsed = rateSheetDefinitionSchema.safeParse(sheet.definition);
              if (parsed.success) {
                resolvedId = sheet.id;
                resolvedName = sheet.name;
                resolvedDefinition = parsed.data;
                source = 'tenant_default';
                trace.push(`Used tenant default rate sheet "${sheet.name}" (${sheet.id}).`);
              } else {
                trace.push(
                  `Tenant default rate sheet ${sheet.id} failed schema validation; falling back.`,
                );
              }
            }
          }
        }

        if (!resolvedDefinition) {
          resolvedDefinition = FALLBACK_DEFINITION;
          trace.push('No tenant rate sheet found; used hard-coded fallback definition.');
        }

        // Step 2: distance (only consulted when both pickup + dropoff coords exist).
        const distanceMiles = haversineMiles(
          input.pickupLat,
          input.pickupLng,
          input.dropoffLat,
          input.dropoffLng,
        );
        if (distanceMiles == null) {
          trace.push('No distance computed (missing or partial coordinates).');
        } else {
          trace.push(`Distance: ${distanceMiles.toFixed(2)} mi (haversine).`);
        }

        // Step 3: build line items.
        const lineItems: RateLineItem[] = [];
        const service = resolvedDefinition.services.find(
          (s) => s.serviceType === input.serviceType,
        );
        if (!service) {
          trace.push(
            `Rate sheet has no entry for service ${input.serviceType}; using fallback service definition.`,
          );
          const fb = FALLBACK_DEFINITION.services.find((s) => s.serviceType === input.serviceType);
          if (fb) {
            lineItems.push({
              code: 'base',
              label: `${labelFor(input.serviceType)} base fee`,
              amountCents: fb.baseCents,
            });
          }
        } else {
          lineItems.push({
            code: 'base',
            label: `${labelFor(input.serviceType)} base fee`,
            amountCents: service.baseCents,
          });
          const flat = service.flatFeesByClass[input.vehicleClass];
          if (flat && flat > 0) {
            lineItems.push({
              code: 'class_flat',
              label: `${classLabel(input.vehicleClass)} flat fee`,
              amountCents: flat,
            });
          }
          const perMile = service.perMileCentsByClass[input.vehicleClass];
          if (perMile && distanceMiles != null && distanceMiles > 0) {
            const billable = Math.max(0, distanceMiles - resolvedDefinition.freeMilesIncluded);
            const mileageCents = Math.round(billable * perMile);
            if (billable > 0) {
              lineItems.push({
                code: 'mileage',
                label: `Mileage (${billable.toFixed(2)} mi @ $${(perMile / 100).toFixed(2)}/mi)`,
                amountCents: mileageCents,
                quantity: Number(billable.toFixed(2)),
                unit: 'mi',
              });
              trace.push(
                `Mileage: ${billable.toFixed(2)} billable mi (after ${resolvedDefinition.freeMilesIncluded} free) × ${perMile}¢ = ${mileageCents}¢.`,
              );
            } else {
              trace.push(
                `Mileage: trip within ${resolvedDefinition.freeMilesIncluded} free mi; no charge.`,
              );
            }
          }
        }

        // Step 4: time-of-day surcharges.
        const scheduled = input.scheduledAt ?? new Date();
        for (const window of resolvedDefinition.surcharges) {
          if (windowMatches(window, scheduled)) {
            lineItems.push({
              code: window.code,
              label: window.label,
              amountCents: window.amountCents,
            });
            trace.push(
              `Surcharge "${window.label}" applied (scheduled UTC ${scheduled.toISOString()}).`,
            );
          }
        }

        // Step 5: fixed line items.
        for (const li of resolvedDefinition.fixedLineItems) {
          lineItems.push({ code: li.code, label: li.label, amountCents: li.amountCents });
        }

        const subtotalCents = lineItems.reduce((acc, li) => acc + li.amountCents, 0);
        const totalCents = subtotalCents;

        return {
          serviceType: input.serviceType,
          vehicleClass: input.vehicleClass,
          rateSheetId: resolvedId,
          rateSheetName: resolvedName,
          source,
          distanceMiles: distanceMiles ?? 0,
          lineItems,
          subtotalCents,
          totalCents,
          calculationTrace: trace,
          currency: 'USD',
        };
      },
    );
  }
}

function haversineMiles(
  lat1?: number | null,
  lng1?: number | null,
  lat2?: number | null,
  lng2?: number | null,
): number | null {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 3958.7613; // Earth radius in miles.
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function windowMatches(window: SurchargeWindow, when: Date): boolean {
  const dow = when.getUTCDay();
  if (window.daysOfWeek.length > 0 && !window.daysOfWeek.includes(dow)) return false;
  const minutes = when.getUTCHours() * 60 + when.getUTCMinutes();
  const start = parseHHmm(window.startHHmm);
  const end = parseHHmm(window.endHHmm);
  if (window.crossesMidnight) {
    return minutes >= start || minutes < end;
  }
  return minutes >= start && minutes < end;
}

function parseHHmm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function labelFor(s: JobServiceType): string {
  const map: Record<JobServiceType, string> = {
    tow: 'Tow',
    jump_start: 'Jump start',
    lockout: 'Lockout',
    tire_change: 'Tire change',
    fuel: 'Fuel delivery',
    winch: 'Winch',
    recovery: 'Recovery',
    impound: 'Impound',
    other: 'Other service',
  };
  return map[s];
}

function classLabel(c: VehicleClass): string {
  const map: Record<VehicleClass, string> = {
    light_duty: 'Light-duty',
    medium_duty: 'Medium-duty',
    heavy_duty: 'Heavy-duty',
    motorcycle: 'Motorcycle',
    commercial: 'Commercial',
    rv: 'RV',
    unknown: 'Unknown class',
  };
  return map[c];
}
