/**
 * Pure HD rate-sheet / on-scene-estimate math. No I/O, no Nest, no DB —
 * deterministic and unit-tested directly. Money is integer cents
 * throughout; each line is Math.round(quantity × unitCents), and the ticket
 * total is Math.round(subtotal × multiplier).
 *
 * Multiplier policy: after-hours and holiday premiums do NOT stack — the
 * higher of the two applicable multipliers wins (a holiday call worked
 * after hours bills at the holiday rate, not holiday × after-hours). This
 * is the conservative, predictable choice; see SESSION_36_DECISIONS.md.
 */

export interface HdRateSheetRates {
  hourlyRateCents: number;
  hookupFeeCents: number;
  winchingPerHrCents: number;
  recoveryPerHrCents: number;
  rotatorPerHrCents: number;
  mileageLoadedCents: number;
  mileageDeadheadCents: number;
  afterHoursMultiplier: number;
  holidayMultiplier: number;
}

export interface HdEstimateInput {
  laborHours: number;
  winchingHours: number;
  recoveryHours: number;
  rotatorHours: number;
  loadedMiles: number;
  deadheadMiles: number;
  includeHookup: boolean;
  afterHours: boolean;
  holiday: boolean;
}

export interface HdEstimateLine {
  code: string;
  label: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface HdEstimateResult {
  lines: HdEstimateLine[];
  subtotalCents: number;
  multiplier: number;
  totalCents: number;
}

/** Effective ticket multiplier (max of the applicable premiums, floor 1). */
export function effectiveMultiplier(rates: HdRateSheetRates, input: HdEstimateInput): number {
  let m = 1;
  if (input.afterHours) m = Math.max(m, rates.afterHoursMultiplier);
  if (input.holiday) m = Math.max(m, rates.holidayMultiplier);
  return m;
}

/**
 * Build an on-scene estimate from a rate sheet + the operator's quantity
 * inputs. Only non-zero lines are emitted. The subtotal is the sum of line
 * amounts; the total applies the effective multiplier.
 */
export function computeOnSceneEstimate(
  rates: HdRateSheetRates,
  input: HdEstimateInput,
): HdEstimateResult {
  const lines: HdEstimateLine[] = [];

  const add = (code: string, label: string, quantity: number, unitCents: number): void => {
    if (quantity <= 0 || unitCents <= 0) return;
    lines.push({ code, label, quantity, unitCents, amountCents: Math.round(quantity * unitCents) });
  };

  if (input.includeHookup) add('hookup', 'Hook-up fee', 1, rates.hookupFeeCents);
  add('labor', 'Labor', input.laborHours, rates.hourlyRateCents);
  add('winching', 'Winching', input.winchingHours, rates.winchingPerHrCents);
  add('recovery', 'Recovery', input.recoveryHours, rates.recoveryPerHrCents);
  add('rotator', 'Rotator', input.rotatorHours, rates.rotatorPerHrCents);
  add('mileage_loaded', 'Mileage (loaded)', input.loadedMiles, rates.mileageLoadedCents);
  add('mileage_deadhead', 'Mileage (deadhead)', input.deadheadMiles, rates.mileageDeadheadCents);

  const subtotalCents = lines.reduce((acc, l) => acc + l.amountCents, 0);
  const multiplier = effectiveMultiplier(rates, input);
  const totalCents = Math.round(subtotalCents * multiplier);

  return { lines, subtotalCents, multiplier, totalCents };
}
