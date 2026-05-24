/**
 * Repo Workflow (Session 49) — case detail aggregate. One round-trip for the
 * /repo/cases/[id] screen: the case, its lienholder, and every child log.
 */
import { z } from 'zod';
import { repoLocationAttemptSchema } from './attempts';
import { repoCaseSchema } from './cases';
import { lienholderSchema } from './lienholders';
import {
  repoConditionPhotoSchema,
  repoPersonalPropertySchema,
  repoRecoveryEventSchema,
} from './recovery';

export const repoCaseDetailSchema = z.object({
  case: repoCaseSchema,
  lienholder: lienholderSchema,
  attempts: z.array(repoLocationAttemptSchema),
  recoveryEvents: z.array(repoRecoveryEventSchema),
  personalProperty: z.array(repoPersonalPropertySchema),
  conditionPhotos: z.array(repoConditionPhotoSchema),
  attemptCount: z.number().int(),
});
export type RepoCaseDetailDto = z.infer<typeof repoCaseDetailSchema>;
