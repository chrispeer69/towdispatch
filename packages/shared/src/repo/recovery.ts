/**
 * Repo Workflow (Session 49) — recovery, condition-photo, and personal-
 * property contracts. Mirror repo_recovery_events / repo_condition_photos /
 * repo_personal_property.
 */
import { z } from 'zod';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

// ----------------------------------------------------------------------
// Recovery events
// ----------------------------------------------------------------------

export const repoRecoveryTypeValues = [
  'peaceful',
  'voluntary_surrender',
  'involuntary_impound',
] as const;
export type RepoRecoveryType = (typeof repoRecoveryTypeValues)[number];

export const repoRecoveryEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  repoCaseId: z.string().uuid(),
  recoveredAt: z.string().datetime(),
  recoveredByUserId: z.string().uuid().nullable(),
  recoveryType: z.enum(repoRecoveryTypeValues),
  odometer: z.number().int().nullable(),
  conditionNotes: z.string().nullable(),
  gpsLat: z.number().nullable(),
  gpsLng: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type RepoRecoveryEventDto = z.infer<typeof repoRecoveryEventSchema>;

export const recordRepoRecoverySchema = z
  .object({
    recoveryType: z.enum(repoRecoveryTypeValues),
    recoveredAt: z.string().datetime().optional(),
    odometer: z.number().int().min(0).max(10_000_000).optional(),
    conditionNotes: z.string().max(5000).optional(),
    gpsLat: lat.optional(),
    gpsLng: lng.optional(),
  })
  .strict();
export type RecordRepoRecoveryPayload = z.infer<typeof recordRepoRecoverySchema>;

// ----------------------------------------------------------------------
// Condition photos (8 standard slots + other)
// ----------------------------------------------------------------------

export const repoConditionPhotoTypeValues = [
  'exterior_front',
  'exterior_rear',
  'exterior_left',
  'exterior_right',
  'interior',
  'odometer',
  'damage',
  'vin_plate',
  'other',
] as const;
export type RepoConditionPhotoType = (typeof repoConditionPhotoTypeValues)[number];

export const repoConditionPhotoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  repoCaseId: z.string().uuid(),
  photoUrl: z.string(),
  photoType: z.enum(repoConditionPhotoTypeValues),
  takenAt: z.string().datetime(),
  gpsLat: z.number().nullable(),
  gpsLng: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type RepoConditionPhotoDto = z.infer<typeof repoConditionPhotoSchema>;

const conditionPhotoItem = z.object({
  photoUrl: z.string().min(1).max(2000),
  photoType: z.enum(repoConditionPhotoTypeValues),
  takenAt: z.string().datetime().optional(),
  gpsLat: lat.optional(),
  gpsLng: lng.optional(),
});

// Accepts a single photo or a batch (the driver uploads the 8-slot checklist
// in one call on job completion).
export const addRepoConditionPhotosSchema = z
  .object({
    photos: z.array(conditionPhotoItem).min(1).max(50),
  })
  .strict();
export type AddRepoConditionPhotosPayload = z.infer<typeof addRepoConditionPhotosSchema>;

// ----------------------------------------------------------------------
// Personal property
// ----------------------------------------------------------------------

export const repoPersonalPropertySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  repoCaseId: z.string().uuid(),
  itemDescription: z.string(),
  photoUrl: z.string().nullable(),
  recordedAt: z.string().datetime(),
  releasedAt: z.string().datetime().nullable(),
  releasedTo: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type RepoPersonalPropertyDto = z.infer<typeof repoPersonalPropertySchema>;

export const addRepoPersonalPropertySchema = z
  .object({
    itemDescription: z.string().min(1).max(1000),
    photoUrl: z.string().max(2000).optional(),
  })
  .strict();
export type AddRepoPersonalPropertyPayload = z.infer<typeof addRepoPersonalPropertySchema>;

export const releaseRepoPersonalPropertySchema = z
  .object({
    releasedTo: z.string().min(1).max(200),
  })
  .strict();
export type ReleaseRepoPersonalPropertyPayload = z.infer<typeof releaseRepoPersonalPropertySchema>;
