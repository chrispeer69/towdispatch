/**
 * Pretrip (DVIR) UI helpers.
 *
 * The driver app collects the inspection as a structured form. This
 * module owns the pure transforms between the on-screen state and the
 * API payload (`CreateDriverPretripInspectionPayload`) so the page can
 * stay thin and so the transform is unit-testable.
 */
import type {
  CreateDriverPretripInspectionPayload,
  DriverPretripInspectionStatus,
  PretripInspectionItem,
  PretripInspectionItemState,
} from '@ustowdispatch/shared';

export interface PretripFormItem {
  key: string;
  label: string;
  categoryKey: string;
  state: PretripInspectionItemState | null;
  note: string;
  photoKeys: string[];
}

export interface PretripFormCategory {
  key: string;
  label: string;
  items: PretripFormItem[];
}

/**
 * Default DVIR checklist. v1 set of items mirrors a common FMCSA pre-trip
 * (we'll add tenant-configurable categories in a follow-up build).
 */
export const DEFAULT_PRETRIP_CATEGORIES: ReadonlyArray<{
  key: string;
  label: string;
  items: ReadonlyArray<{ key: string; label: string }>;
}> = [
  {
    key: 'exterior',
    label: 'Exterior',
    items: [
      { key: 'lights_head', label: 'Headlights & high beams' },
      { key: 'lights_tail', label: 'Tail / brake / turn lights' },
      { key: 'mirrors', label: 'Side mirrors + windshield' },
      { key: 'body_damage', label: 'Truck body damage (note any new dents)' },
    ],
  },
  {
    key: 'tires_brakes',
    label: 'Tires, brakes, wheels',
    items: [
      { key: 'tires_tread', label: 'Tire tread + sidewalls' },
      { key: 'tires_pressure', label: 'Tire pressure (all 6)' },
      { key: 'brakes_parking', label: 'Parking brake holds' },
      { key: 'brakes_service', label: 'Service brakes' },
    ],
  },
  {
    key: 'wrecker',
    label: 'Wrecker equipment',
    items: [
      { key: 'boom_winch', label: 'Boom / winch operation' },
      { key: 'cables_chains', label: 'Cables & chains' },
      { key: 'hooks_dollies', label: 'Hooks & dollies' },
      { key: 'lights_warning', label: 'Warning / strobe lights' },
    ],
  },
  {
    key: 'safety',
    label: 'Safety & cab',
    items: [
      { key: 'horn', label: 'Horn' },
      { key: 'wipers', label: 'Wipers & washer fluid' },
      { key: 'fluids', label: 'Engine oil + coolant level' },
      { key: 'first_aid', label: 'First-aid kit + fire extinguisher' },
    ],
  },
];

export function newDefaultForm(): PretripFormCategory[] {
  return DEFAULT_PRETRIP_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    items: c.items.map((i) => ({
      key: i.key,
      label: i.label,
      categoryKey: c.key,
      state: null,
      note: '',
      photoKeys: [],
    })),
  }));
}

/**
 * Reduce a form's items into the rollup status that the API expects.
 * Rules:
 *   - any `fail` with state `fail` and a note flagging safety → 'fail_unsafe'
 *   - any `fail` whose item key contains 'brakes' or 'tires' → 'fail_unsafe'
 *     (operator policy: brakes/tires are non-negotiable)
 *   - any other `fail` → 'fail_safe'
 *   - everything `ok` → 'pass'
 *   - mix of `ok` and `attention` (no fails) → 'pass' (driver can drive,
 *     but the attention items are flagged for the next maintenance window)
 */
export function rollupStatus(form: PretripFormCategory[]): DriverPretripInspectionStatus {
  const flat = form.flatMap((c) => c.items);
  const fails = flat.filter((i) => i.state === 'fail');
  if (fails.length === 0) return 'pass';
  const unsafe = fails.some((i) => /brakes|tires|lights_warning|cables_chains/.test(i.key));
  return unsafe ? 'fail_unsafe' : 'fail_safe';
}

export class PretripValidationError extends Error {
  readonly itemKey: string;
  constructor(itemKey: string, message: string) {
    super(message);
    this.itemKey = itemKey;
  }
}

/**
 * Validate the form and produce the API payload. Throws
 * PretripValidationError when an item is incomplete (missing state,
 * fail without a note or photo).
 */
export function buildPretripPayload(input: {
  form: PretripFormCategory[];
  truckId: string;
  shiftId?: string;
  odometerMiles?: number;
  notes?: string;
}): CreateDriverPretripInspectionPayload {
  const items: PretripInspectionItem[] = [];
  for (const category of input.form) {
    for (const item of category.items) {
      if (item.state == null) {
        throw new PretripValidationError(item.key, `Mark ${item.label} as PASS / FAIL / N/A`);
      }
      if (item.state === 'fail') {
        if (!item.note.trim()) {
          throw new PretripValidationError(
            item.key,
            `Add a note explaining the fail for ${item.label}`,
          );
        }
        if (item.photoKeys.length === 0) {
          throw new PretripValidationError(
            item.key,
            `Attach at least one photo for the fail on ${item.label}`,
          );
        }
      }
      items.push({
        key: item.key,
        label: item.label,
        state: item.state,
        ...(item.note.trim() ? { note: item.note.trim() } : {}),
        ...(item.photoKeys.length > 0 ? { photoKeys: item.photoKeys } : {}),
      });
    }
  }
  const status = rollupStatus(input.form);
  const payload: CreateDriverPretripInspectionPayload = {
    truckId: input.truckId,
    status,
    items,
    submittedAt: new Date().toISOString(),
    ...(input.shiftId ? { shiftId: input.shiftId } : {}),
    ...(input.odometerMiles !== undefined ? { odometerMiles: input.odometerMiles } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
  return payload;
}
