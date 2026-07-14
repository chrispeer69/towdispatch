/**
 * Job duty-class derivation (CADS). A job's duty class decides which
 * capacity bucket it loads. Derived once at intake from service type +
 * vehicle class, stored on the job, and reclassable by dispatch — the
 * derivation is a starting point, not an authority.
 */
import type { CapacityDutyClass } from './core';

/** Mirrors vehicles.vehicle_class values (packages/db vehicles schema). */
const VEHICLE_CLASS_TO_DUTY: Record<string, CapacityDutyClass> = {
  light_duty: 'light',
  motorcycle: 'light',
  unknown: 'light',
  medium_duty: 'medium',
  commercial: 'medium',
  rv: 'medium',
  heavy_duty: 'heavy',
};

/**
 * Vehicle class dominates (a heavy-duty jump start still needs a heavy
 * presence on scene is FALSE — but towing/winching/recovering one does, and
 * roadside-only service types on heavy vehicles still bill/route heavy in
 * practice, so we keep the single-axis rule: vehicle class wins, service
 * type only matters when the vehicle is unknown). Recovery/winch with no
 * vehicle data defaults medium — those calls are rarely light-duty work.
 */
export function deriveJobDutyClass(
  serviceType: string,
  vehicleClass: string | null | undefined,
): CapacityDutyClass {
  if (vehicleClass) {
    const mapped = VEHICLE_CLASS_TO_DUTY[vehicleClass];
    if (mapped && mapped !== 'light') return mapped;
    if (mapped === 'light' && vehicleClass !== 'unknown') return 'light';
  }
  if (serviceType === 'recovery' || serviceType === 'winch') return 'medium';
  return 'light';
}
