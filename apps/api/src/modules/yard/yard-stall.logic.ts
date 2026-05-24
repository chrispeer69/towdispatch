/**
 * Pure stall-assignment rules for the yard module (Session 54). No I/O —
 * unit-tested directly. The service is thin orchestration over this.
 */
import type {
  StallAssignmentCheck,
  StorageVehicleClass,
  YardStallType,
} from '@ustowdispatch/shared';

export interface StallAssignmentInput {
  stall: {
    deletedAt: Date | string | null;
    occupiedByImpoundId: string | null;
    stallType: YardStallType;
  };
  impoundId: string;
  vehicleClass: StorageVehicleClass;
  isElectric: boolean;
}

/** Vehicle classes too large to fit a `standard` stall. */
const OVERSIZED_CLASSES: ReadonlySet<StorageVehicleClass> = new Set<StorageVehicleClass>([
  'heavy',
  'rv',
  'trailer',
]);

/**
 * Can this vehicle be parked in this stall? Checks, in order:
 *   - the stall is live (not soft-deleted),
 *   - the stall is free (or already holds this same vehicle — idempotent),
 *   - an `ev` stall only takes an electric vehicle,
 *   - a `standard` stall won't take an oversized class (heavy / rv / trailer).
 * `oversized`/`covered`/`secure`/`hazmat` stalls accept any class — they are
 * capacity/handling attributes, not size restrictions.
 */
export function validateStallAssignment(input: StallAssignmentInput): StallAssignmentCheck {
  const { stall } = input;
  if (stall.deletedAt !== null) {
    return { allowed: false, reason: 'Stall has been removed.' };
  }
  if (stall.occupiedByImpoundId !== null && stall.occupiedByImpoundId !== input.impoundId) {
    return { allowed: false, reason: 'Stall is already occupied by another vehicle.' };
  }
  if (stall.stallType === 'ev' && !input.isElectric) {
    return { allowed: false, reason: 'EV stall requires an electric vehicle.' };
  }
  if (stall.stallType === 'standard' && OVERSIZED_CLASSES.has(input.vehicleClass)) {
    return {
      allowed: false,
      reason: 'This vehicle is too large for a standard stall; use an oversized stall.',
    };
  }
  return { allowed: true, reason: null };
}
