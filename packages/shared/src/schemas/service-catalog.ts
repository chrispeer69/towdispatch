/**
 * Service Catalog contracts — DTO + create/update payloads + list filters.
 *
 * The catalog itself is structural: code, name, category, calculation_unit,
 * applicable vehicle classes, default-commission override, soft-delete flag.
 * Prices do NOT live here — those land with the Master Rate Sheet (build 2
 * of the Admin Settings rollout).
 *
 * Shared by the NestJS service-catalog controller (ZodBody / ZodQuery) and
 * the web settings UI (react-hook-form via the Zod resolver), same pattern
 * as the rest of @ustowdispatch/shared. Decimals are exchanged as strings
 * end-to-end so the 53-bit Number mantissa can't silently lose precision.
 */
import { z } from 'zod';
import { vehicleClassValues } from './vehicle';

export const serviceCategoryValues = [
  'towing',
  'mileage',
  'roadside_service',
  'recovery',
  'storage_impound',
  'fees_surcharges',
  'adjustments',
  'equipment',
  'overages',
] as const;
export type ServiceCategory = (typeof serviceCategoryValues)[number];

export const serviceCalculationUnitValues = [
  'per_call',
  'per_mile',
  'per_hour',
  'per_quarter_hour',
  'per_day',
  'quoted',
] as const;
export type ServiceCalculationUnit = (typeof serviceCalculationUnitValues)[number];

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  towing: 'Towing',
  mileage: 'Mileage',
  roadside_service: 'Roadside service',
  recovery: 'Recovery',
  storage_impound: 'Storage / impound',
  fees_surcharges: 'Fees & surcharges',
  adjustments: 'Adjustments',
  equipment: 'Equipment',
  overages: 'Overages',
};

export const SERVICE_CALCULATION_UNIT_LABELS: Record<ServiceCalculationUnit, string> = {
  per_call: 'Per call',
  per_mile: 'Per mile',
  per_hour: 'Per hour',
  per_quarter_hour: 'Per quarter hour (15 min)',
  per_day: 'Per day',
  quoted: 'Quoted at quote time',
};

const codeSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    'Uppercase letters, digits, and underscores only; must start with a letter',
  );

const commissionPctSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Must be a percent with up to 2 fractional digits')
  .refine(
    (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    },
    { message: '0-100 inclusive' },
  );

export const serviceCatalogEntrySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  code: codeSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(1000).nullable(),
  category: z.enum(serviceCategoryValues),
  calculationUnit: z.enum(serviceCalculationUnitValues),
  applicableVehicleClasses: z.array(z.enum(vehicleClassValues)),
  isQuoted: z.boolean(),
  defaultCommissionPctOverride: commissionPctSchema.nullable(),
  supportsPerResourceMultiplier: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
});
export type ServiceCatalogEntryDto = z.infer<typeof serviceCatalogEntrySchema>;

/**
 * Create payload. is_quoted is derived from calculation_unit so the UI only
 * needs to send the unit; the API enforces the equivalence and the DB has a
 * CHECK constraint as a belt-and-braces safeguard. We still accept isQuoted
 * in the payload for explicit callers (CLI scripts, integration tests).
 */
export const createServiceCatalogSchema = z
  .object({
    code: codeSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(1000).optional(),
    category: z.enum(serviceCategoryValues),
    calculationUnit: z.enum(serviceCalculationUnitValues),
    applicableVehicleClasses: z.array(z.enum(vehicleClassValues)).default([]),
    isQuoted: z.boolean().optional(),
    defaultCommissionPctOverride: commissionPctSchema.optional(),
    supportsPerResourceMultiplier: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .refine((v) => v.isQuoted === undefined || v.isQuoted === (v.calculationUnit === 'quoted'), {
    message: 'isQuoted must match calculationUnit === "quoted"',
    path: ['isQuoted'],
  });
export type CreateServiceCatalogPayload = z.infer<typeof createServiceCatalogSchema>;

/**
 * Update payload — every field optional, same is_quoted/calculation_unit
 * consistency rule when both are supplied. Partial-update of a single
 * inconsistent value is allowed because the API derives is_quoted from the
 * resulting calculation_unit at write time.
 */
export const updateServiceCatalogSchema = z
  .object({
    code: codeSchema.optional(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(1000).nullable().optional(),
    category: z.enum(serviceCategoryValues).optional(),
    calculationUnit: z.enum(serviceCalculationUnitValues).optional(),
    applicableVehicleClasses: z.array(z.enum(vehicleClassValues)).optional(),
    isQuoted: z.boolean().optional(),
    defaultCommissionPctOverride: commissionPctSchema.nullable().optional(),
    supportsPerResourceMultiplier: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .refine(
    (v) =>
      v.isQuoted === undefined ||
      v.calculationUnit === undefined ||
      v.isQuoted === (v.calculationUnit === 'quoted'),
    {
      message: 'isQuoted must match calculationUnit === "quoted"',
      path: ['isQuoted'],
    },
  );
export type UpdateServiceCatalogPayload = z.infer<typeof updateServiceCatalogSchema>;

const boolFromString = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
  .optional();

export const serviceCatalogFiltersSchema = z.object({
  category: z.enum(serviceCategoryValues).optional(),
  active: boolFromString,
  vehicleClass: z.enum(vehicleClassValues).optional(),
  q: z.string().max(120).optional(),
});
export type ServiceCatalogFilters = z.infer<typeof serviceCatalogFiltersSchema>;

export const seedDefaultServiceCatalogResponseSchema = z.object({
  inserted: z.number().int().nonnegative(),
});
export type SeedDefaultServiceCatalogResponse = z.infer<
  typeof seedDefaultServiceCatalogResponseSchema
>;
