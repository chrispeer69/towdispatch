/**
 * Translate a job's RateQuote (Session 4 rate engine output) into the
 * invoice_line_items rows we persist on the draft invoice.
 *
 * The rate engine emits coarse-grained items (`base`, `mileage`,
 * `class_flat`, time-of-day surcharge codes, fixed fees). The invoice schema
 * uses a richer line_type enum so the printed PDF and reporting know the
 * difference between a winch line and an after-hours surcharge. We map the
 * rate-engine `code` to a line_type via `mapRateCodeToLineType` — anything
 * we don't recognize lands as 'custom' so the data is never lost.
 *
 * Money is integer cents in. Quantity is a numeric string out (Postgres
 * NUMERIC). We don't re-derive prices; the rate engine already rounded.
 */
import type { JobServiceType, RateLineItem, RateQuote } from '@ustowdispatch/shared';
import type { InvoiceLineItemType } from '@ustowdispatch/shared';

export interface DraftInvoiceLineItem {
  lineNumber: number;
  lineType: InvoiceLineItemType;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  lineTotalCents: number;
  taxable: boolean;
  taxRatePct: string;
  rateRuleId: string | null;
}

/** Default tax-rate-percent used when the tenant has no tax setting. */
const DEFAULT_TAX_RATE = '0';

interface ConvertOptions {
  /** When true, mileage / hourly lines are taxable; defaults reflect typical state rules. */
  taxable?: boolean;
  /** Per-line rate as decimal percent (e.g., '7.5'). */
  taxRatePct?: string;
}

export function rateQuoteToInvoiceLineItems(
  quote: RateQuote,
  options: ConvertOptions = {},
): DraftInvoiceLineItem[] {
  const taxable = options.taxable ?? false;
  const taxRatePct = options.taxRatePct ?? DEFAULT_TAX_RATE;
  return quote.lineItems.map((rateLine: RateLineItem, idx: number) =>
    rateLineToDraft(rateLine, idx + 1, taxable, taxRatePct),
  );
}

/**
 * GOA / cancellation single-line invoice. Emits a flat fee — the operator
 * decides whether to bill it. Caller passes the dollar amount and reason.
 */
export function goaInvoiceLineItem(amountCents: number, reason: string): DraftInvoiceLineItem {
  return {
    lineNumber: 1,
    lineType: 'service',
    description: reason || 'Gone-on-arrival fee',
    quantity: '1',
    unit: 'each',
    unitPriceCents: amountCents,
    lineTotalCents: amountCents,
    taxable: false,
    taxRatePct: DEFAULT_TAX_RATE,
    rateRuleId: 'goa_flat',
  };
}

/** Daily-storage invoice line item (used by the recurring billing job). */
export function storageInvoiceLineItem(
  daysCount: number,
  dailyRateCents: number,
  description: string,
  taxable = false,
  taxRatePct = DEFAULT_TAX_RATE,
): DraftInvoiceLineItem {
  const safeDays = Math.max(0, Math.floor(daysCount));
  return {
    lineNumber: 1,
    lineType: 'storage_daily',
    description,
    quantity: String(safeDays),
    unit: 'day',
    unitPriceCents: dailyRateCents,
    lineTotalCents: safeDays * dailyRateCents,
    taxable,
    taxRatePct,
    rateRuleId: 'storage_daily',
  };
}

function rateLineToDraft(
  line: RateLineItem,
  lineNumber: number,
  taxable: boolean,
  taxRatePct: string,
): DraftInvoiceLineItem {
  const lineType = mapRateCodeToLineType(line.code);
  const quantity = line.quantity != null ? String(line.quantity) : '1';
  const unit = line.unit ?? 'each';
  const unitPriceCents = computeUnitPrice(line);
  return {
    lineNumber,
    lineType,
    description: line.label,
    quantity,
    unit,
    unitPriceCents,
    lineTotalCents: line.amountCents,
    taxable: shouldDefaultTaxable(lineType, taxable),
    taxRatePct,
    rateRuleId: line.code,
  };
}

function computeUnitPrice(line: RateLineItem): number {
  if (line.quantity != null && line.quantity > 0) {
    // The rate engine already rounds; recover unit price by integer division
    // when possible, fall back to the full amount otherwise.
    const quotient = line.amountCents / line.quantity;
    if (Number.isFinite(quotient)) {
      return Math.round(quotient);
    }
  }
  return line.amountCents;
}

function shouldDefaultTaxable(lineType: InvoiceLineItemType, fallback: boolean): boolean {
  // Discount and write-off-shaped lines are never taxable.
  if (lineType === 'discount') return false;
  return fallback;
}

/**
 * Map the rate-engine code (or fallback patterns) to a billing line_type.
 * Anything unrecognized falls back to 'custom' so we never drop data.
 */
export function mapRateCodeToLineType(code: string): InvoiceLineItemType {
  switch (code) {
    case 'base':
    case 'class_flat':
      return 'service';
    case 'mileage':
      return 'mileage_loaded';
    case 'mileage_unloaded':
      return 'mileage_unloaded';
    case 'wait_time':
    case 'waiting':
      return 'wait_time';
    case 'winch':
      return 'winch';
    case 'recovery':
      return 'recovery';
    case 'environmental':
    case 'fuel_surcharge':
      return 'environmental';
    case 'admin_fee':
    case 'admin':
      return 'admin';
    case 'discount':
      return 'discount';
    case 'storage_daily':
      return 'storage_daily';
    default:
      // Time-of-day surcharges typically come back as `night`, `weekend`,
      // `after_hours`, etc. Detect by suffix.
      if (/(night|weekend|holiday|after_hours|after-hours)/i.test(code)) {
        return 'after_hours';
      }
      if (/equipment|dolly|skates|extra_axle|wheel_lift/i.test(code)) {
        return 'equipment_surcharge';
      }
      return 'custom';
  }
}

/** Make a sensible bill-to address jsonb from a customer or account record. */
export function billingAddressFromCustomer(c: {
  name: string;
  homeAddressStreet?: string | null;
  homeAddressCity?: string | null;
  homeAddressState?: string | null;
  homeAddressZip?: string | null;
  email?: string | null;
  phone?: string | null;
}): Record<string, unknown> {
  return {
    name: c.name,
    street: c.homeAddressStreet ?? null,
    city: c.homeAddressCity ?? null,
    state: c.homeAddressState ?? null,
    zip: c.homeAddressZip ?? null,
    country: 'US',
    email: c.email ?? null,
    phone: c.phone ?? null,
  };
}

export function billingAddressFromAccount(a: {
  name: string;
  billingAddress?: unknown;
  billingEmail?: string | null;
  billingPhone?: string | null;
  apContactName?: string | null;
  apContactEmail?: string | null;
}): Record<string, unknown> {
  const addr = (a.billingAddress as Record<string, unknown> | null | undefined) ?? {};
  return {
    name: a.apContactName ? `${a.name} (${a.apContactName})` : a.name,
    street: addr.street ?? null,
    city: addr.city ?? null,
    state: addr.state ?? null,
    zip: addr.zip ?? null,
    country: 'US',
    email: a.apContactEmail ?? a.billingEmail ?? null,
    phone: a.billingPhone ?? null,
  };
}

/**
 * Serialize the JobServiceType into a customer-readable label for the invoice
 * "service performed" caption. Mirrors the dispatcher-facing label used in
 * the rate engine.
 */
export function serviceTypeLabel(s: JobServiceType): string {
  const map: Record<JobServiceType, string> = {
    tow: 'Tow',
    jump_start: 'Jump start',
    lockout: 'Lockout',
    tire_change: 'Tire change',
    fuel: 'Fuel delivery',
    winch: 'Winch service',
    recovery: 'Recovery service',
    impound: 'Impound tow',
    repo: 'Repossession',
    other: 'Service',
  };
  return map[s];
}
