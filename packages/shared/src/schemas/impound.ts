/**
 * Impound & Storage (Session 22) — Zod contracts for the impound module.
 *
 * Mirrors the Drizzle schema enums + column shapes in
 * packages/db/src/schema/impound-*.ts. Timestamps cross the wire as
 * ISO-8601 strings; `date` columns (accrued_for_date, last_accrued_on)
 * cross as YYYY-MM-DD strings. Cents are integers.
 *
 * Status transitions and the release documentation gate are enforced in
 * the service layer; payload schemas here intentionally omit machine
 * fields (status, accrued_fee_cents, released_at, …) so clients cannot
 * bypass the state machine.
 */
import { z } from 'zod';

// ----------------------------------------------------------------------
// Enums (mirror the DB CHECK constraints)
// ----------------------------------------------------------------------

export const impoundRecordStatusValues = [
  'stored',
  'pending_release',
  'released',
  'transferred',
  'disposed',
] as const;
export type ImpoundRecordStatus = (typeof impoundRecordStatusValues)[number];

export const impoundHoldTypeValues = ['police', 'abandoned', 'accident', 'owner_request'] as const;
export type ImpoundHoldType = (typeof impoundHoldTypeValues)[number];

export const impoundFeeTypeValues = [
  'daily_storage',
  'intake',
  'administrative',
  'lien_processing',
  'gate',
  'other',
] as const;
export type ImpoundFeeType = (typeof impoundFeeTypeValues)[number];

// Manual fees the operator can add by hand — daily_storage is cron-only.
export const impoundManualFeeTypeValues = [
  'intake',
  'administrative',
  'lien_processing',
  'gate',
  'other',
] as const;
export type ImpoundManualFeeType = (typeof impoundManualFeeTypeValues)[number];

export const impoundReleaseToTypeValues = [
  'owner',
  'agent',
  'insurance',
  'lienholder',
  'salvage',
  'other',
] as const;
export type ImpoundReleaseToType = (typeof impoundReleaseToTypeValues)[number];

export const impoundReleasePaymentMethodValues = [
  'cash',
  'card',
  'check',
  'ach',
  'waived',
  'other',
] as const;
export type ImpoundReleasePaymentMethod = (typeof impoundReleasePaymentMethodValues)[number];

export const impoundCloseDispositionValues = ['transferred', 'disposed'] as const;
export type ImpoundCloseDisposition = (typeof impoundCloseDispositionValues)[number];

// ----------------------------------------------------------------------
// DTOs
// ----------------------------------------------------------------------

export const impoundYardSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  capacity: z.number().int().nullable(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type ImpoundYardDto = z.infer<typeof impoundYardSchema>;

export const impoundRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  yardId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  vehicleId: z.string().uuid().nullable(),
  vehicleMake: z.string().nullable(),
  vehicleModel: z.string().nullable(),
  vehicleYear: z.number().int().nullable(),
  vehicleColor: z.string().nullable(),
  vehicleVin: z.string().nullable(),
  licensePlate: z.string().nullable(),
  licenseState: z.string().nullable(),
  status: z.enum(impoundRecordStatusValues),
  arrivedAt: z.string().datetime(),
  storageStartedAt: z.string().datetime(),
  releasedAt: z.string().datetime().nullable(),
  dailyFeeCents: z.number().int(),
  intakeMileage: z.number().int().nullable(),
  intakePhotoKeys: z.array(z.string()),
  conditionNotes: z.string().nullable(),
  lienEligible: z.boolean(),
  lienEligibleAt: z.string().datetime().nullable(),
  accruedFeeCents: z.number().int(),
  lastAccruedOn: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type ImpoundRecordDto = z.infer<typeof impoundRecordSchema>;

export const impoundHoldSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  impoundRecordId: z.string().uuid(),
  holdType: z.enum(impoundHoldTypeValues),
  authorityName: z.string().nullable(),
  authorityReference: z.string().nullable(),
  reason: z.string().nullable(),
  placedBy: z.string().uuid().nullable(),
  placedAt: z.string().datetime(),
  releasedAt: z.string().datetime().nullable(),
  releasedBy: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type ImpoundHoldDto = z.infer<typeof impoundHoldSchema>;

export const impoundFeeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  impoundRecordId: z.string().uuid(),
  feeType: z.enum(impoundFeeTypeValues),
  description: z.string().nullable(),
  amountCents: z.number().int(),
  accruedForDate: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type ImpoundFeeDto = z.infer<typeof impoundFeeSchema>;

export const impoundReleaseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  impoundRecordId: z.string().uuid(),
  releasedToName: z.string(),
  releasedToType: z.enum(impoundReleaseToTypeValues),
  idVerified: z.boolean(),
  ownershipDocVerified: z.boolean(),
  authorizationDocRef: z.string().nullable(),
  paymentReceivedCents: z.number().int(),
  paymentMethod: z.enum(impoundReleasePaymentMethodValues).nullable(),
  totalFeesCents: z.number().int(),
  releasedBy: z.string().uuid().nullable(),
  releasedAt: z.string().datetime(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type ImpoundReleaseDto = z.infer<typeof impoundReleaseSchema>;

// Aggregate the detail endpoint returns.
export const impoundRecordDetailSchema = z.object({
  record: impoundRecordSchema,
  yard: impoundYardSchema,
  holds: z.array(impoundHoldSchema),
  fees: z.array(impoundFeeSchema),
  release: impoundReleaseSchema.nullable(),
  feeTotalCents: z.number().int(),
  activeHoldCount: z.number().int(),
});
export type ImpoundRecordDetailDto = z.infer<typeof impoundRecordDetailSchema>;

// ----------------------------------------------------------------------
// Yard payloads
// ----------------------------------------------------------------------

export const createImpoundYardSchema = z
  .object({
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(50),
    addressLine1: z.string().max(200).optional(),
    addressLine2: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    capacity: z.number().int().min(1).max(1_000_000).optional(),
    isActive: z.boolean().default(true),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type CreateImpoundYardPayload = z.infer<typeof createImpoundYardSchema>;

export const updateImpoundYardSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(50).optional(),
    addressLine1: z.string().max(200).nullable().optional(),
    addressLine2: z.string().max(200).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(100).nullable().optional(),
    postalCode: z.string().max(20).nullable().optional(),
    capacity: z.number().int().min(1).max(1_000_000).nullable().optional(),
    isActive: z.boolean().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();
export type UpdateImpoundYardPayload = z.infer<typeof updateImpoundYardSchema>;

// ----------------------------------------------------------------------
// Record / intake payloads
// ----------------------------------------------------------------------

export const createImpoundRecordSchema = z
  .object({
    yardId: z.string().uuid(),
    jobId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    vehicleMake: z.string().max(120).optional(),
    vehicleModel: z.string().max(120).optional(),
    vehicleYear: z.number().int().min(1900).max(2200).optional(),
    vehicleColor: z.string().max(60).optional(),
    vehicleVin: z.string().max(64).optional(),
    licensePlate: z.string().max(32).optional(),
    licenseState: z.string().max(32).optional(),
    arrivedAt: z.string().datetime().optional(),
    storageStartedAt: z.string().datetime().optional(),
    dailyFeeCents: z.number().int().min(0).max(100_000_000).default(0),
    intakeMileage: z.number().int().min(0).max(10_000_000).optional(),
    conditionNotes: z.string().max(20_000).optional(),
    intakePhotoKeys: z.array(z.string().min(1).max(1024)).max(50).default([]),
  })
  .strict();
export type CreateImpoundRecordPayload = z.infer<typeof createImpoundRecordSchema>;

export const updateImpoundRecordSchema = z
  .object({
    yardId: z.string().uuid().optional(),
    vehicleMake: z.string().max(120).nullable().optional(),
    vehicleModel: z.string().max(120).nullable().optional(),
    vehicleYear: z.number().int().min(1900).max(2200).nullable().optional(),
    vehicleColor: z.string().max(60).nullable().optional(),
    vehicleVin: z.string().max(64).nullable().optional(),
    licensePlate: z.string().max(32).nullable().optional(),
    licenseState: z.string().max(32).nullable().optional(),
    dailyFeeCents: z.number().int().min(0).max(100_000_000).optional(),
    intakeMileage: z.number().int().min(0).max(10_000_000).nullable().optional(),
    conditionNotes: z.string().max(20_000).nullable().optional(),
  })
  .strict();
export type UpdateImpoundRecordPayload = z.infer<typeof updateImpoundRecordSchema>;

export const registerImpoundPhotosSchema = z
  .object({
    keys: z.array(z.string().min(1).max(1024)).min(1).max(50),
  })
  .strict();
export type RegisterImpoundPhotosPayload = z.infer<typeof registerImpoundPhotosSchema>;

export const closeImpoundRecordSchema = z
  .object({
    disposition: z.enum(impoundCloseDispositionValues),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type CloseImpoundRecordPayload = z.infer<typeof closeImpoundRecordSchema>;

// ----------------------------------------------------------------------
// Hold payloads
// ----------------------------------------------------------------------

export const addImpoundHoldSchema = z
  .object({
    holdType: z.enum(impoundHoldTypeValues),
    authorityName: z.string().max(200).optional(),
    authorityReference: z.string().max(200).optional(),
    reason: z.string().max(5000).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type AddImpoundHoldPayload = z.infer<typeof addImpoundHoldSchema>;

export const releaseImpoundHoldSchema = z
  .object({
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type ReleaseImpoundHoldPayload = z.infer<typeof releaseImpoundHoldSchema>;

// ----------------------------------------------------------------------
// Fee payloads
// ----------------------------------------------------------------------

export const addImpoundFeeSchema = z
  .object({
    feeType: z.enum(impoundManualFeeTypeValues),
    amountCents: z.number().int().min(0).max(1_000_000_000),
    description: z.string().max(2000).optional(),
  })
  .strict();
export type AddImpoundFeePayload = z.infer<typeof addImpoundFeeSchema>;

// ----------------------------------------------------------------------
// Release payloads
// ----------------------------------------------------------------------

export const createImpoundReleaseSchema = z
  .object({
    releasedToName: z.string().min(1).max(200),
    releasedToType: z.enum(impoundReleaseToTypeValues),
    idVerified: z.boolean(),
    ownershipDocVerified: z.boolean(),
    authorizationDocRef: z.string().max(200).optional(),
    paymentReceivedCents: z.number().int().min(0).max(1_000_000_000).default(0),
    paymentMethod: z.enum(impoundReleasePaymentMethodValues).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type CreateImpoundReleasePayload = z.infer<typeof createImpoundReleaseSchema>;

// ----------------------------------------------------------------------
// List filters
// ----------------------------------------------------------------------

export const listImpoundRecordsFilterSchema = z
  .object({
    status: z.enum(impoundRecordStatusValues).optional(),
    yardId: z.string().uuid().optional(),
    lienEligible: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListImpoundRecordsFilter = z.infer<typeof listImpoundRecordsFilterSchema>;

// ----------------------------------------------------------------------
// State-form generation stub (Session 23 lands the real documents)
// ----------------------------------------------------------------------

export const impoundFormKindValues = [
  'lien_notice',
  'release_authorization',
  'abandoned_vehicle_notice',
  'storage_invoice',
] as const;
export type ImpoundFormKind = (typeof impoundFormKindValues)[number];

export const impoundFormStubSchema = z.object({
  kind: z.enum(impoundFormKindValues),
  recordId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  status: z.literal('stub'),
  message: z.string(),
  // The data the real form will render from, surfaced now so clients can
  // build the UI against a stable shape ahead of Session 23.
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type ImpoundFormStub = z.infer<typeof impoundFormStubSchema>;
