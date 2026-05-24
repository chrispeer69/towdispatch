/**
 * Repo Workflow (Session 49) — location-attempt contracts. Mirrors
 * `repo_location_attempts`. The append-only field log.
 */
import { z } from 'zod';

export const repoAttemptOutcomeValues = [
  'not_home',
  'wrong_address',
  'spotted_no_attempt',
  'attempted_failed',
  'peaceful_recovery',
  'surrendered',
] as const;
export type RepoAttemptOutcome = (typeof repoAttemptOutcomeValues)[number];

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const repoLocationAttemptSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  repoCaseId: z.string().uuid(),
  attemptedAt: z.string().datetime(),
  attemptedByUserId: z.string().uuid().nullable(),
  address: z.string().nullable(),
  outcome: z.enum(repoAttemptOutcomeValues),
  notes: z.string().nullable(),
  gpsLat: z.number().nullable(),
  gpsLng: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type RepoLocationAttemptDto = z.infer<typeof repoLocationAttemptSchema>;

export const recordRepoAttemptSchema = z
  .object({
    outcome: z.enum(repoAttemptOutcomeValues),
    attemptedAt: z.string().datetime().optional(),
    address: z.string().max(400).optional(),
    notes: z.string().max(5000).optional(),
    gpsLat: lat.optional(),
    gpsLng: lng.optional(),
  })
  .strict();
export type RecordRepoAttemptPayload = z.infer<typeof recordRepoAttemptSchema>;
