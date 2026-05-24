/**
 * Repo Compliance (Session 50) — rule-engine input/output contracts.
 *
 * There is no repo_cases table this session (S49 not on master — see
 * SESSION_50_DECISIONS.md D0), so these schemas describe the FACTS the pure
 * engine consumes and the results it returns, used by the self-contained
 * preview endpoints (POST /repo-compliance/next-action, …). When S49 lands its
 * RepoCaseService will derive `RepoCaseFacts` from a real case row.
 */
import { z } from 'zod';
import { repoStateValues } from './state-rules';

// ----------------------------------------------------------------------
// Case workflow position (mirrors how S49 will model a repo case)
// ----------------------------------------------------------------------

export const repoCaseStatusValues = [
  'open',
  'recovered',
  'redeemed',
  'disposed',
  'closed',
  'canceled',
] as const;
export type RepoCaseStatus = (typeof repoCaseStatusValues)[number];

export const repoCaseStepValues = [
  'opened',
  'pre_repo_notice_sent',
  'recovered',
  'post_repo_notice_sent',
  'redemption_period',
  'ready_for_disposition',
] as const;
export type RepoCaseStep = (typeof repoCaseStepValues)[number];

// ----------------------------------------------------------------------
// computeNextRepoAction — input facts + result
// ----------------------------------------------------------------------

export const repoActionValues = [
  'send_pre_repo_notice',
  'await_pre_repo_cure_period',
  'record_recovery',
  'send_post_repo_notice',
  'notify_sheriff',
  'notify_secondary_contact',
  'await_redemption_period',
  'resolve_breach_flag',
  'resolve_debtor_response',
  'ready_for_disposition',
  'none',
] as const;
export type RepoActionType = (typeof repoActionValues)[number];

// Datetimes cross the wire as ISO-8601 strings; the engine works in Date.
export const repoCaseFactsSchema = z.object({
  state: z.enum(repoStateValues),
  status: z.enum(repoCaseStatusValues),
  currentStep: z.enum(repoCaseStepValues),
  openedAt: z.string().datetime(),
  preRepoNoticeSentAt: z.string().datetime().nullable(),
  recoveredAt: z.string().datetime().nullable(),
  postRepoNoticeSentAt: z.string().datetime().nullable(),
  sheriffNoticeSentAt: z.string().datetime().nullable(),
  secondaryContactNotifiedAt: z.string().datetime().nullable(),
  debtorResponseAt: z.string().datetime().nullable(),
  breachOfPeaceFlagged: z.boolean(),
});
export type RepoCaseFacts = z.infer<typeof repoCaseFactsSchema>;

export const repoNextActionSchema = z.object({
  action: z.enum(repoActionValues),
  dueAt: z.string().datetime().nullable(),
  // True while the case cannot legally proceed to disposition (a prerequisite
  // is outstanding, a breach was flagged, or the debtor responded).
  blocking: z.boolean(),
  statuteCitation: z.string(),
  reasons: z.array(z.string()),
});
export type RepoNextAction = z.infer<typeof repoNextActionSchema>;

// ----------------------------------------------------------------------
// validatePeacefulRepo — input attempt + result
// ----------------------------------------------------------------------

export const repoAttemptFactsSchema = z.object({
  state: z.enum(repoStateValues),
  debtorPresent: z.boolean(),
  debtorObjected: z.boolean(),
  breachedLockedEnclosure: z.boolean(),
  enteredResidence: z.boolean(),
  usedOrThreatenedForce: z.boolean(),
  lawEnforcementDirected: z.boolean(),
  occurredAtNight: z.boolean(),
});
export type RepoAttemptFacts = z.infer<typeof repoAttemptFactsSchema>;

export const repoPeacefulResultSchema = z.object({
  allowed: z.boolean(),
  violations: z.array(z.string()),
  statuteCitation: z.string(),
});
export type RepoPeacefulResult = z.infer<typeof repoPeacefulResultSchema>;

// ----------------------------------------------------------------------
// computePersonalPropertyHold — input + result
// ----------------------------------------------------------------------

export const repoPersonalPropertyHoldRequestSchema = z
  .object({
    state: z.enum(repoStateValues),
    recoveredAt: z.string().datetime(),
  })
  .strict();
export type RepoPersonalPropertyHoldRequest = z.infer<typeof repoPersonalPropertyHoldRequestSchema>;

export const repoPersonalPropertyHoldResultSchema = z.object({
  holdUntil: z.string().datetime(),
  holdDays: z.number().int().min(0),
  releaseMethod: z.string(),
  statuteCitation: z.string(),
});
export type RepoPersonalPropertyHoldResult = z.infer<typeof repoPersonalPropertyHoldResultSchema>;
