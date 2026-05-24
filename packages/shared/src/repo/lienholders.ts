/**
 * Repo Workflow (Session 49) — lienholder contracts.
 *
 * The repossession client, tenant-scoped. Mirrors the `lienholders` Drizzle
 * schema. Timestamps cross the wire as ISO-8601 strings. Enum value arrays
 * mirror the DB CHECK constraints (the shared package does not import @db).
 */
import { z } from 'zod';

export const lienholderInvoiceFormatValues = ['basic', 'rdn', 'clearplan'] as const;
export type LienholderInvoiceFormat = (typeof lienholderInvoiceFormatValues)[number];

// Free-form per-lienholder billing terms (net-30, recovery-fee schedule, …).
// Kept open (passthrough) in v1 — the structured rate sheet is an S52 concern.
export const lienholderBillingTermsSchema = z.record(z.string(), z.unknown());
export type LienholderBillingTerms = z.infer<typeof lienholderBillingTermsSchema>;

export const lienholderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  billingTerms: lienholderBillingTermsSchema.nullable(),
  invoiceFormat: z.enum(lienholderInvoiceFormatValues),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type LienholderDto = z.infer<typeof lienholderSchema>;

export const createLienholderSchema = z
  .object({
    name: z.string().min(1).max(200),
    contactName: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().email().max(200).optional(),
    addressLine1: z.string().max(200).optional(),
    addressLine2: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(40).optional(),
    postalCode: z.string().max(20).optional(),
    billingTerms: lienholderBillingTermsSchema.optional(),
    invoiceFormat: z.enum(lienholderInvoiceFormatValues).optional(),
    notes: z.string().max(5000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type CreateLienholderPayload = z.infer<typeof createLienholderSchema>;

export const updateLienholderSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    contactName: z.string().max(200).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    email: z.string().email().max(200).nullable().optional(),
    addressLine1: z.string().max(200).nullable().optional(),
    addressLine2: z.string().max(200).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(40).nullable().optional(),
    postalCode: z.string().max(20).nullable().optional(),
    billingTerms: lienholderBillingTermsSchema.nullable().optional(),
    invoiceFormat: z.enum(lienholderInvoiceFormatValues).optional(),
    notes: z.string().max(5000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateLienholderPayload = z.infer<typeof updateLienholderSchema>;

export const listLienholdersFilterSchema = z
  .object({
    active: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListLienholdersFilter = z.infer<typeof listLienholdersFilterSchema>;
