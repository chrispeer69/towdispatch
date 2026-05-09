/**
 * Account contract schemas. Shared by the API (NestJS ZodBody) and the web
 * (react-hook-form via the Zod resolver).
 *
 * Decimals are exchanged as strings end-to-end so the JS Number's 53-bit
 * mantissa never silently lossily truncates a credit limit. The DB stores
 * numeric(12,2); the wire keeps the same fidelity.
 */
import { z } from 'zod';

export const billingTermsValues = [
  'net_15',
  'net_30',
  'net_45',
  'net_60',
  'cod',
  'prepay',
] as const;
export type BillingTerm = (typeof billingTermsValues)[number];

export const billingAddressSchema = z
  .object({
    street: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(40).optional(),
    zip: z.string().max(20).optional(),
    country: z.string().max(60).optional(),
  })
  .strict();
export type BillingAddress = z.infer<typeof billingAddressSchema>;

const decimalString = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Must be a decimal with up to 2 fractional digits');

export const accountSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(240),
  accountNumber: z.string().max(60).nullable(),
  billingTerms: z.enum(billingTermsValues),
  creditLimit: decimalString.nullable(),
  creditUsed: decimalString,
  billingAddress: billingAddressSchema.nullable(),
  billingEmail: z.string().email().max(254).nullable(),
  billingPhone: z.string().max(40).nullable(),
  apContactName: z.string().max(240).nullable(),
  apContactEmail: z.string().email().max(254).nullable(),
  coiRequired: z.boolean(),
  coiExpiresAt: z.string().nullable(),
  coiDocumentUrl: z.string().url().max(2048).nullable(),
  defaultRateSheetId: z.string().uuid().nullable(),
  isMotorClub: z.boolean(),
  motorClubNetworkCode: z.string().max(60).nullable(),
  active: z.boolean(),
  notes: z.string().max(4000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
});
export type AccountDto = z.infer<typeof accountSchema>;

export const createAccountSchema = z.object({
  name: z.string().min(1).max(240),
  accountNumber: z.string().max(60).optional(),
  billingTerms: z.enum(billingTermsValues).default('net_30'),
  creditLimit: decimalString.optional(),
  billingAddress: billingAddressSchema.optional(),
  billingEmail: z.string().email().max(254).optional(),
  billingPhone: z.string().max(40).optional(),
  apContactName: z.string().max(240).optional(),
  apContactEmail: z.string().email().max(254).optional(),
  coiRequired: z.boolean().optional(),
  coiExpiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required')
    .optional(),
  coiDocumentUrl: z.string().url().max(2048).optional(),
  isMotorClub: z.boolean().optional(),
  motorClubNetworkCode: z.string().max(60).optional(),
  active: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
});
export type CreateAccountPayload = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = createAccountSchema.partial();
export type UpdateAccountPayload = z.infer<typeof updateAccountSchema>;

export const accountFiltersSchema = z.object({
  q: z.string().max(120).optional(),
  active: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
  isMotorClub: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type AccountFilters = z.infer<typeof accountFiltersSchema>;

export const accountSearchQuerySchema = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type AccountSearchQuery = z.infer<typeof accountSearchQuerySchema>;

export const paginatedAccountsSchema = z.object({
  data: z.array(accountSchema),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type PaginatedAccounts = z.infer<typeof paginatedAccountsSchema>;
