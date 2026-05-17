/**
 * Account Rate Card contracts — per-account pricing overrides, service
 * availability, and contract terms (Admin Settings build 6 of 7).
 *
 * Overrides come in three patterns:
 *   - flat_price            : the new price in cents replaces master
 *   - flat_dollar_discount  : override_value_cents subtracted from master
 *   - percent_discount      : override_percent (0-100) off master
 *
 * Exactly one of overrideValueCents / overridePercent is meaningful per
 * row, enforced via a Zod discriminated refinement and a DB CHECK
 * constraint. The wire shape always sends both fields; the unused one is
 * null / zero so the JSON shape stays uniform.
 */
import { z } from 'zod';
import { rateVehicleClassValues } from './service-rate';

export const accountRateOverrideTypeValues = [
  'flat_price',
  'percent_discount',
  'flat_dollar_discount',
] as const;
export type AccountRateOverrideType = (typeof accountRateOverrideTypeValues)[number];

export const ACCOUNT_RATE_OVERRIDE_TYPE_LABELS: Record<AccountRateOverrideType, string> = {
  flat_price: 'Flat price',
  percent_discount: 'Percent off',
  flat_dollar_discount: 'Dollar off',
};

export const accountServiceAvailabilityValues = [
  'available',
  'not_covered',
  'pre_approval_required',
] as const;
export type AccountServiceAvailabilityValue = (typeof accountServiceAvailabilityValues)[number];

export const ACCOUNT_SERVICE_AVAILABILITY_LABELS: Record<AccountServiceAvailabilityValue, string> =
  {
    available: 'Available',
    not_covered: 'Not covered',
    pre_approval_required: 'Pre-approval required',
  };

export const accountPaymentTermsValues = ['net_15', 'net_30', 'net_45', 'due_on_receipt'] as const;
export type AccountPaymentTermValue = (typeof accountPaymentTermsValues)[number];

export const ACCOUNT_PAYMENT_TERMS_LABELS: Record<AccountPaymentTermValue, string> = {
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_45: 'Net 45',
  due_on_receipt: 'Due on receipt',
};

// -------- Override DTOs --------

const overrideValueCentsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const overridePercentSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Must be a percent with up to 2 fractional digits')
  .refine(
    (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    },
    { message: '0-100 inclusive' },
  );

/**
 * Wire shape for an account rate override. Includes the joined catalog
 * fields (code, name, category) so the UI grid can render without a
 * second round-trip per row, plus effectivePriceCents — the price the
 * override resolves to right now given the current master rate — so the
 * dispatcher sees the final number live.
 */
export const accountRateOverrideDtoSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  serviceCatalogId: z.string().uuid(),
  serviceCode: z.string(),
  serviceName: z.string(),
  category: z.string(),
  vehicleClass: z.string().nullable(),
  overrideType: z.enum(accountRateOverrideTypeValues),
  overrideValueCents: z.number().int().nonnegative(),
  overridePercent: z.string().nullable(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  /**
   * The price this override resolves to in cents given the current
   * master rate. Null when no master rate exists yet (operator has not
   * priced this service in the Master Rate Sheet) — the UI should warn
   * that the override has nothing to apply to.
   */
  effectivePriceCents: z.number().int().nonnegative().nullable(),
  /**
   * Pre-formatted "$NN.NN" string for display. Built server-side so the
   * UI's number formatter doesn't drift from the wire format.
   */
  priceDisplay: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AccountRateOverrideDto = z.infer<typeof accountRateOverrideDtoSchema>;

/**
 * Single override upsert. The override_type ↔ value field consistency
 * is enforced via .superRefine so the API can 400 before the DB CHECK
 * fires. The discriminated union mirrors the DB CHECK exactly.
 */
export const accountRateOverrideUpsertItemSchema = z
  .object({
    serviceCatalogId: z.string().uuid(),
    vehicleClass: z.enum(rateVehicleClassValues).nullable(),
    overrideType: z.enum(accountRateOverrideTypeValues),
    overrideValueCents: overrideValueCentsSchema.optional(),
    overridePercent: overridePercentSchema.optional(),
    isActive: z.boolean().optional().default(true),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.overrideType === 'percent_discount') {
      if (v.overridePercent === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overridePercent'],
          message: 'percent_discount requires overridePercent',
        });
      }
      if (v.overrideValueCents !== undefined && v.overrideValueCents !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overrideValueCents'],
          message: 'percent_discount must have overrideValueCents = 0 or omitted',
        });
      }
    } else {
      // flat_price | flat_dollar_discount
      if (v.overrideValueCents === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overrideValueCents'],
          message: `${v.overrideType} requires overrideValueCents`,
        });
      }
      if (v.overridePercent !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overridePercent'],
          message: `${v.overrideType} must not have overridePercent`,
        });
      }
    }
  });
export type AccountRateOverrideUpsertItem = z.infer<typeof accountRateOverrideUpsertItemSchema>;

// -------- Availability DTOs --------

export const accountServiceAvailabilityDtoSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  serviceCatalogId: z.string().uuid(),
  serviceCode: z.string(),
  serviceName: z.string(),
  category: z.string(),
  availability: z.enum(accountServiceAvailabilityValues),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AccountServiceAvailabilityDto = z.infer<typeof accountServiceAvailabilityDtoSchema>;

export const accountServiceAvailabilityUpsertItemSchema = z.object({
  serviceCatalogId: z.string().uuid(),
  availability: z.enum(accountServiceAvailabilityValues),
  notes: z.string().max(2000).optional(),
});
export type AccountServiceAvailabilityUpsertItem = z.infer<
  typeof accountServiceAvailabilityUpsertItemSchema
>;

// -------- Bulk + composite DTOs --------

export const bulkUpdateAccountRateCardSchema = z.object({
  overrides: z.array(accountRateOverrideUpsertItemSchema).max(500).optional(),
  availability: z.array(accountServiceAvailabilityUpsertItemSchema).max(500).optional(),
});
export type BulkUpdateAccountRateCardPayload = z.infer<typeof bulkUpdateAccountRateCardSchema>;

/**
 * The GET /accounts/:id/rate-card payload. Sums of every surface the UI
 * grid needs to render: the account summary, the master rate rows for
 * comparison, the override rows, and the availability rows. The web
 * client groups, filters, and merges these in-memory.
 */
export const accountRateCardAccountSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isMotorClub: z.boolean(),
  active: z.boolean(),
  motorClubNetworkCode: z.string().nullable(),
  accountNumber: z.string().nullable(),
});
export type AccountRateCardAccountSummaryDto = z.infer<typeof accountRateCardAccountSummarySchema>;

/**
 * Master rate row included in the rate-card response. Joined catalog
 * fields are duplicated alongside the price so the UI can render each
 * row in one pass without re-fetching the catalog.
 */
export const masterRateRowDtoSchema = z.object({
  serviceCatalogId: z.string().uuid(),
  serviceCode: z.string(),
  serviceName: z.string(),
  category: z.string(),
  calculationUnit: z.string(),
  applicableVehicleClasses: z.array(z.string()),
  sortOrder: z.number().int(),
  vehicleClass: z.string(),
  priceCents: z.number().int().nullable(),
});
export type MasterRateRowDto = z.infer<typeof masterRateRowDtoSchema>;

export const accountRateCardDtoSchema = z.object({
  account: accountRateCardAccountSummarySchema,
  masterRates: z.array(masterRateRowDtoSchema),
  overrides: z.array(accountRateOverrideDtoSchema),
  availability: z.array(accountServiceAvailabilityDtoSchema),
});
export type AccountRateCardDto = z.infer<typeof accountRateCardDtoSchema>;

// -------- Contract terms --------

export const accountContractTermsDtoSchema = z.object({
  paymentTerms: z.enum(accountPaymentTermsValues),
  requiresPhotoBeforeBilling: z.boolean(),
  requiresAuthorizationCode: z.boolean(),
  goaPolicy: z.string().nullable(),
  slaArrivalMinutes: z.number().int().positive().nullable(),
  afterHoursBillingAllowed: z.boolean(),
});
export type AccountContractTermsDto = z.infer<typeof accountContractTermsDtoSchema>;

export const updateAccountContractTermsSchema = z.object({
  paymentTerms: z.enum(accountPaymentTermsValues).optional(),
  requiresPhotoBeforeBilling: z.boolean().optional(),
  requiresAuthorizationCode: z.boolean().optional(),
  goaPolicy: z.string().max(4000).nullable().optional(),
  slaArrivalMinutes: z.number().int().positive().nullable().optional(),
  afterHoursBillingAllowed: z.boolean().optional(),
});
export type UpdateAccountContractTermsPayload = z.infer<typeof updateAccountContractTermsSchema>;

// -------- Helpers --------

/**
 * Resolve the effective price in cents for an override given a master
 * rate. Returns null when masterPriceCents is null and the override is
 * percent or dollar-off (those modes need a base to discount). flat_price
 * resolves to its own value regardless of master state — that's the
 * "operator typed an explicit number, ignore master" path.
 *
 * Shared so the API computes effectivePriceCents server-side and the UI
 * recomputes live as the operator edits a draft cell.
 */
export function resolveAccountOverridePriceCents(
  overrideType: AccountRateOverrideType,
  overrideValueCents: number,
  overridePercent: string | null,
  masterPriceCents: number | null,
): number | null {
  if (overrideType === 'flat_price') {
    return Math.max(0, overrideValueCents);
  }
  if (masterPriceCents == null) return null;
  if (overrideType === 'flat_dollar_discount') {
    return Math.max(0, masterPriceCents - overrideValueCents);
  }
  // percent_discount
  const pct = overridePercent != null ? Number(overridePercent) : 0;
  if (!Number.isFinite(pct)) return masterPriceCents;
  return Math.max(0, Math.round(masterPriceCents * (1 - pct / 100)));
}
