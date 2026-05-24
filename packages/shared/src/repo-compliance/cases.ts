/**
 * Repo Compliance (Session 51) — repossession case workflow contracts.
 *
 * These enums describe the compliance lifecycle the pure rule engine drives.
 * The case persistence layer (a RepoCaseService) was scoped to Session 49 and
 * is NOT built here — Session 51 ships only the data, per-state config, rule
 * engine, notices, and tests (see SESSION_51_DECISIONS.md). The engine never
 * mutates anything and never decides to DISPOSE; that is always an explicit
 * operator action.
 */
import { z } from 'zod';
import { repoStateValues, repoValueTierValues } from './state-rules';

// ----------------------------------------------------------------------
// Enums (mirror the eventual DB CHECK constraints)
// ----------------------------------------------------------------------

export const repoCaseStatusValues = [
  'open',
  'ready_for_disposition',
  'disposed',
  'closed',
  'canceled',
] as const;
export type RepoCaseStatus = (typeof repoCaseStatusValues)[number];

export const repoCaseStepValues = [
  'opened',
  'pre_repo_notice_sent',
  'repossessed',
  'post_repo_notice_sent',
  'redemption_period',
  'ready_for_disposition',
  'disposed',
  'closed',
] as const;
export type RepoCaseStep = (typeof repoCaseStepValues)[number];

// ----------------------------------------------------------------------
// Rule-engine next-action contract
// ----------------------------------------------------------------------

export const repoActionValues = [
  'send_pre_repo_notice',
  'await_cure_period',
  'complete_repossession',
  'secure_personal_property',
  'send_post_repo_notice',
  'await_redemption_period',
  'mark_ready_for_disposition',
  'conduct_disposition',
  'send_deficiency_notice',
  'resolve_claim',
  'none',
] as const;
export type RepoActionType = (typeof repoActionValues)[number];

export const repoNextActionSchema = z.object({
  action: z.enum(repoActionValues),
  dueAt: z.string().datetime().nullable(),
  // True while the case cannot legally proceed to disposition (a prerequisite
  // is outstanding or a dispute was received). False only once
  // ready_for_disposition / disposed / closed.
  blocking: z.boolean(),
  reasons: z.array(z.string()),
});
export type RepoNextAction = z.infer<typeof repoNextActionSchema>;

// ----------------------------------------------------------------------
// Filter contract (for a future list endpoint; included for parity)
// ----------------------------------------------------------------------

export const listRepoCasesFilterSchema = z
  .object({
    state: z.enum(repoStateValues).optional(),
    status: z.enum(repoCaseStatusValues).optional(),
    step: z.enum(repoCaseStepValues).optional(),
    valueTier: z.enum(repoValueTierValues).optional(),
    // 'true' restricts to open cases whose next action is now-or-past due.
    dueSoon: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListRepoCasesFilter = z.infer<typeof listRepoCasesFilterSchema>;
