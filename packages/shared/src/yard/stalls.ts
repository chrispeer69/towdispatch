/**
 * Yard Management (Session 54) — stall + stall-photo contracts.
 * Mirrors packages/db/src/schema/yard-stalls.ts + yard-stall-photos.ts.
 */
import { z } from 'zod';

export const yardStallTypeValues = [
  'standard',
  'oversized',
  'covered',
  'secure',
  'hazmat',
  'ev',
] as const;
export type YardStallType = (typeof yardStallTypeValues)[number];

export const yardStallPhotoTypeValues = [
  'overview',
  'vehicle_in',
  'vehicle_out',
  'condition',
] as const;
export type YardStallPhotoType = (typeof yardStallPhotoTypeValues)[number];

export const yardStallSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  facilityId: z.string().uuid(),
  label: z.string(),
  rowLabel: z.string().nullable(),
  colLabel: z.string().nullable(),
  x: z.number().int(),
  y: z.number().int(),
  stallType: z.enum(yardStallTypeValues),
  occupiedByImpoundId: z.string().uuid().nullable(),
  occupiedSince: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type YardStallDto = z.infer<typeof yardStallSchema>;

export const yardStallPhotoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  stallId: z.string().uuid(),
  photoUrl: z.string(),
  photoType: z.enum(yardStallPhotoTypeValues),
  capturedAt: z.string().datetime(),
  capturedByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type YardStallPhotoDto = z.infer<typeof yardStallPhotoSchema>;

/** Stall detail = the stall plus its photos and the occupant snapshot. */
export const yardStallDetailSchema = z.object({
  stall: yardStallSchema,
  photos: z.array(yardStallPhotoSchema),
  occupant: z
    .object({
      impoundId: z.string().uuid(),
      vehicleDescription: z.string(),
      licensePlate: z.string().nullable(),
      vehicleVin: z.string().nullable(),
      status: z.string(),
    })
    .nullable(),
});
export type YardStallDetailDto = z.infer<typeof yardStallDetailSchema>;

export const createYardStallSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    rowLabel: z.string().max(20).optional(),
    colLabel: z.string().max(20).optional(),
    x: z.number().int().min(0).max(10_000).default(0),
    y: z.number().int().min(0).max(10_000).default(0),
    stallType: z.enum(yardStallTypeValues).default('standard'),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type CreateYardStallPayload = z.infer<typeof createYardStallSchema>;

export const updateYardStallSchema = z
  .object({
    label: z.string().trim().min(1).max(40).optional(),
    rowLabel: z.string().max(20).nullable().optional(),
    colLabel: z.string().max(20).nullable().optional(),
    x: z.number().int().min(0).max(10_000).optional(),
    y: z.number().int().min(0).max(10_000).optional(),
    stallType: z.enum(yardStallTypeValues).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateYardStallPayload = z.infer<typeof updateYardStallSchema>;

export const assignStallSchema = z
  .object({
    impoundId: z.string().uuid(),
  })
  .strict();
export type AssignStallPayload = z.infer<typeof assignStallSchema>;

/** Bulk layout: reposition/retype many stalls in one call (drag-drop save). */
export const bulkStallLayoutSchema = z
  .object({
    stalls: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            x: z.number().int().min(0).max(10_000),
            y: z.number().int().min(0).max(10_000),
            stallType: z.enum(yardStallTypeValues).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();
export type BulkStallLayoutPayload = z.infer<typeof bulkStallLayoutSchema>;

export const registerStallPhotoSchema = z
  .object({
    photoUrl: z.string().url().max(2000),
    photoType: z.enum(yardStallPhotoTypeValues).default('overview'),
  })
  .strict();
export type RegisterStallPhotoPayload = z.infer<typeof registerStallPhotoSchema>;

/** Pure validateStallAssignment result (shared so web can render reasons). */
export interface StallAssignmentCheck {
  allowed: boolean;
  reason: string | null;
}
