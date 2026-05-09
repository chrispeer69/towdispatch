/**
 * Customer contract schemas. Shared by API + web.
 *
 * Phone is stored as E.164 (digits prefixed with +). The phone is the natural
 * dispatch lookup key — no formal validation library here, just a permissive
 * regex that catches obvious typos without rejecting international formats.
 */
import { z } from 'zod';
import { billingAddressSchema } from './account';

// Motor clubs are accounts (is_motor_club=true), NOT customers. The actual
// customer is the person whose vehicle is being towed; their type is 'cash'
// even when the call comes through Agero. See migration 0007.
export const customerTypeValues = ['cash', 'account'] as const;
export type CustomerType = (typeof customerTypeValues)[number];

export const customerCreatedViaValues = ['manual', 'auto_intake'] as const;
export type CustomerCreatedVia = (typeof customerCreatedViaValues)[number];

export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'E.164 format required (e.g. +15555550100)')
  .max(16);

export const customerSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: z.enum(customerTypeValues),
  name: z.string().min(1).max(240),
  email: z.string().email().max(254).nullable(),
  phone: phoneE164Schema.nullable(),
  billingAddress: billingAddressSchema.nullable(),
  accountId: z.string().uuid().nullable(),
  taxExempt: z.boolean(),
  taxExemptCertificateUrl: z.string().url().max(2048).nullable(),
  notes: z.string().max(4000).nullable(),
  createdVia: z.enum(customerCreatedViaValues),
  defaultRateSheetId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
});
export type CustomerDto = z.infer<typeof customerSchema>;

export const customerWithVehiclesSchema = customerSchema.extend({
  vehicles: z.array(
    z.object({
      id: z.string().uuid(),
      year: z.number().int().nullable(),
      make: z.string().nullable(),
      model: z.string().nullable(),
      vin: z.string().nullable(),
      plate: z.string().nullable(),
      plateState: z.string().nullable(),
      relationship: z.string(),
      isPrimary: z.boolean(),
    }),
  ),
});
export type CustomerWithVehiclesDto = z.infer<typeof customerWithVehiclesSchema>;

export const createCustomerSchema = z
  .object({
    type: z.enum(customerTypeValues).default('cash'),
    name: z.string().min(1).max(240),
    email: z.string().email().max(254).optional(),
    phone: phoneE164Schema.optional(),
    billingAddress: billingAddressSchema.optional(),
    accountId: z.string().uuid().optional(),
    taxExempt: z.boolean().optional(),
    taxExemptCertificateUrl: z.string().url().max(2048).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((v) => (v.type === 'cash' ? true : v.accountId !== undefined), {
    message: 'accountId is required when type is "account"',
    path: ['accountId'],
  });
export type CreateCustomerPayload = z.infer<typeof createCustomerSchema>;

/**
 * Input for findOrCreateByContact — used by Session 4 (Call Intake) when a
 * dispatcher takes a call from someone not yet in the system. Phone is
 * required because it's the lookup key.
 */
export const findOrCreateByContactSchema = z.object({
  name: z.string().min(1).max(240),
  phone: phoneE164Schema,
  email: z.string().email().max(254).optional(),
  billingAddress: billingAddressSchema.optional(),
});
export type FindOrCreateByContactPayload = z.infer<typeof findOrCreateByContactSchema>;

export const findOrCreateByContactResultSchema = z.object({
  customer: customerSchema,
  created: z.boolean(),
});
export type FindOrCreateByContactResult = z.infer<typeof findOrCreateByContactResultSchema>;

export const updateCustomerSchema = z
  .object({
    type: z.enum(customerTypeValues).optional(),
    name: z.string().min(1).max(240).optional(),
    email: z.string().email().max(254).nullable().optional(),
    phone: phoneE164Schema.nullable().optional(),
    billingAddress: billingAddressSchema.nullable().optional(),
    accountId: z.string().uuid().nullable().optional(),
    taxExempt: z.boolean().optional(),
    taxExemptCertificateUrl: z.string().url().max(2048).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type UpdateCustomerPayload = z.infer<typeof updateCustomerSchema>;

export const customerFiltersSchema = z.object({
  q: z.string().max(120).optional(),
  type: z.enum(customerTypeValues).optional(),
  accountId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type CustomerFilters = z.infer<typeof customerFiltersSchema>;

export const customerSearchQuerySchema = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type CustomerSearchQuery = z.infer<typeof customerSearchQuerySchema>;

export const customerSearchResultSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  type: z.enum(customerTypeValues),
  vehicleCount: z.number().int().nonnegative(),
});
export type CustomerSearchResult = z.infer<typeof customerSearchResultSchema>;

export const paginatedCustomersSchema = z.object({
  data: z.array(customerSchema),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type PaginatedCustomers = z.infer<typeof paginatedCustomersSchema>;
