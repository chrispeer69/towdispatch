/**
 * Repo Workflow (Session 49) — repo case contracts.
 *
 * Mirrors the `repo_cases` Drizzle schema. Status transitions are enforced in
 * RepoCaseService; payloads omit machine-managed fields (status, *_at
 * timestamps, redemption_ends_at) so clients cannot bypass the workflow.
 * A secondary debtor address is free-form jsonb.
 */
import { z } from 'zod';

export const repoCaseStatusValues = [
  'open',
  'located',
  'recovered',
  'surrendered',
  'closed',
  'cancelled',
] as const;
export type RepoCaseStatus = (typeof repoCaseStatusValues)[number];

// Disposition for closeCase: a normal close, or a cancellation (lienholder
// pulled the assignment). 'recovered'/'surrendered' are reached via
// recordRecovery, not close, so they are not close dispositions.
export const repoCloseDispositionValues = ['closed', 'cancelled'] as const;
export type RepoCloseDisposition = (typeof repoCloseDispositionValues)[number];

export const repoSecondaryAddressSchema = z.record(z.string(), z.unknown());

export const repoCaseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  lienholderId: z.string().uuid(),
  caseNumber: z.string(),
  vin: z.string().nullable(),
  vehicleYear: z.number().int().nullable(),
  vehicleMake: z.string().nullable(),
  vehicleModel: z.string().nullable(),
  vehicleColor: z.string().nullable(),
  plate: z.string().nullable(),
  debtorName: z.string().nullable(),
  debtorAddress: z.string().nullable(),
  debtorPhone: z.string().nullable(),
  debtorSecondaryAddress: repoSecondaryAddressSchema.nullable(),
  status: z.enum(repoCaseStatusValues),
  assignedAt: z.string().datetime(),
  locatedAt: z.string().datetime().nullable(),
  recoveredAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  redemptionWindowDays: z.number().int().nullable(),
  redemptionEndsAt: z.string().datetime().nullable(),
  refAssignmentId: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type RepoCaseDto = z.infer<typeof repoCaseSchema>;

const vehicleYear = z.number().int().min(1900).max(2200);

export const createRepoCaseSchema = z
  .object({
    lienholderId: z.string().uuid(),
    caseNumber: z.string().min(1).max(120),
    vin: z.string().max(40).optional(),
    vehicleYear: vehicleYear.optional(),
    vehicleMake: z.string().max(80).optional(),
    vehicleModel: z.string().max(80).optional(),
    vehicleColor: z.string().max(40).optional(),
    plate: z.string().max(20).optional(),
    debtorName: z.string().max(200).optional(),
    debtorAddress: z.string().max(400).optional(),
    debtorPhone: z.string().max(40).optional(),
    debtorSecondaryAddress: repoSecondaryAddressSchema.optional(),
    redemptionWindowDays: z.number().int().min(0).max(3650).optional(),
    refAssignmentId: z.string().max(200).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type CreateRepoCasePayload = z.infer<typeof createRepoCaseSchema>;

export const updateRepoCaseSchema = z
  .object({
    vin: z.string().max(40).nullable().optional(),
    vehicleYear: vehicleYear.nullable().optional(),
    vehicleMake: z.string().max(80).nullable().optional(),
    vehicleModel: z.string().max(80).nullable().optional(),
    vehicleColor: z.string().max(40).nullable().optional(),
    plate: z.string().max(20).nullable().optional(),
    debtorName: z.string().max(200).nullable().optional(),
    debtorAddress: z.string().max(400).nullable().optional(),
    debtorPhone: z.string().max(40).nullable().optional(),
    debtorSecondaryAddress: repoSecondaryAddressSchema.nullable().optional(),
    redemptionWindowDays: z.number().int().min(0).max(3650).nullable().optional(),
    refAssignmentId: z.string().max(200).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();
export type UpdateRepoCasePayload = z.infer<typeof updateRepoCaseSchema>;

// Marks a case 'located' (recorded a confirmed sighting without recovery).
export const markRepoCaseLocatedSchema = z
  .object({
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type MarkRepoCaseLocatedPayload = z.infer<typeof markRepoCaseLocatedSchema>;

export const closeRepoCaseSchema = z
  .object({
    disposition: z.enum(repoCloseDispositionValues),
    reason: z.string().max(5000).optional(),
  })
  .strict();
export type CloseRepoCasePayload = z.infer<typeof closeRepoCaseSchema>;

export const listRepoCasesFilterSchema = z
  .object({
    lienholderId: z.string().uuid().optional(),
    status: z.enum(repoCaseStatusValues).optional(),
    // Restrict to cases assigned at least N days ago and still open/located
    // (the "aging" worklist a forwarder chases).
    minDaysOpen: z.coerce.number().int().min(0).max(3650).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();
export type ListRepoCasesFilter = z.infer<typeof listRepoCasesFilterSchema>;
