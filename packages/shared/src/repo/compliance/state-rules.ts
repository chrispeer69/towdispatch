/**
 * Repo Compliance (Session 50) — per-state repossession rule contract.
 *
 * `RepoStateRules` is the jsonb shape stored in repo_state_rules.rules and the
 * typed config the rule engine reads (state-rules.config.ts in the API is the
 * runtime source of truth). Session 50 ships the top 10 states (CA, TX, FL,
 * NY, GA, NC, OH, IL, PA, MI); the remaining 40 + DC are deferred to Session
 * 51 — `repoStateValues` is the single lever, exactly as `lienStateValues` was
 * for the lien module (S23 → S35).
 *
 * Repossession is governed by UCC §9-609 (self-help permitted only WITHOUT a
 * breach of the peace) plus each state's deficiency / redemption / personal-
 * property statutes. The day-counts and flags below are best-effort against
 * each jurisdiction's code and MUST be reviewed by counsel before any
 * production repossession — see SESSION_50_DECISIONS.md for the conservative-
 * vs-aggressive choices.
 */
import { z } from 'zod';

// Top 10 states (Session 50). Remaining 40 + DC land in Session 51; append
// them here and the engine, tables, and tests pick them up automatically.
export const repoStateValues = [
  'CA',
  'TX',
  'FL',
  'NY',
  'GA',
  'NC',
  'OH',
  'IL',
  'PA',
  'MI',
] as const;
export type RepoState = (typeof repoStateValues)[number];

// How a required notice is delivered (mirrors the DB CHECK).
export const repoDeliveryMethodValues = ['certified', 'publication', 'email', 'posted'] as const;
export type RepoDeliveryMethod = (typeof repoDeliveryMethodValues)[number];

// Who a required notice is addressed to (mirrors the DB CHECK).
export const repoRecipientRoleValues = [
  'debtor',
  'secondary_contact',
  'lienholder',
  'sheriff',
] as const;
export type RepoRecipientRole = (typeof repoRecipientRoleValues)[number];

// How personal property left in the vehicle is returned to the debtor.
export const repoReleaseMethodValues = [
  'owner_pickup_after_notice',
  'mail_return',
  'disposal_after_hold',
] as const;
export type RepoReleaseMethod = (typeof repoReleaseMethodValues)[number];

export const repoStateRulesSchema = z.object({
  // Statutory citation. Best-effort; verify against current state code.
  statute: z.string(),
  // Plain-language description of what constitutes a breach of the peace in
  // this state (surfaced to operators + cited on the warning banner).
  peacefulRepoDefinition: z.string(),
  // Whether a notice / right-to-cure is required BEFORE the repossession may
  // proceed (e.g. OH, PA right-to-cure regimes). Most states: false (UCC
  // self-help needs no pre-repo notice).
  preRepoNoticeRequired: z.boolean(),
  // Days the debtor has to cure after a pre-repo notice; 0 when not required.
  preRepoNoticeDays: z.number().int().min(0),
  // Whether a post-repossession notice (of sale / right to redeem) is required.
  postRepoNoticeRequired: z.boolean(),
  // Days after recovery within which the post-repo notice must be sent.
  postRepoNoticeDays: z.number().int().min(0),
  // Delivery method the post-repo notice must use.
  postRepoNoticeMethod: z.enum(repoDeliveryMethodValues),
  // Pre-sale statutory redemption window in days; 0 when the state grants only
  // a post-sale right (we never invent a window — see SESSION_50_DECISIONS.md).
  redemptionPeriodDays: z.number().int().min(0),
  // Whether the debtor has a statutory right to cure the default.
  cureRight: z.boolean(),
  // Days the cure right stays open; 0 when cureRight is false.
  cureRightDays: z.number().int().min(0),
  // Days the secured party must hold personal property left in the vehicle.
  personalPropertyHoldDays: z.number().int().min(0),
  // How that personal property is released.
  personalPropertyReleaseMethod: z.enum(repoReleaseMethodValues),
  // Whether a secondary contact (co-signer / reference) must also be notified.
  secondaryContactRequired: z.boolean(),
  // Whether the repossession must be reported to law enforcement (e.g. NC, to
  // clear stolen-vehicle reports).
  sheriffNoticeRequired: z.boolean(),
  // The jurisdiction the sheriff notice goes to; null when not required.
  sheriffNoticeJurisdiction: z.string().nullable(),
  // Breach-of-peace escalations beyond the UCC-uniform core (see the engine).
  // nightRepoIsBreach: true where case law treats a nighttime repo as a breach.
  nightRepoIsBreach: z.boolean(),
  // presenceObjectionStrict: true (conservative default) — a present, objecting
  // debtor ends the right to proceed.
  presenceObjectionStrict: z.boolean(),
});
export type RepoStateRules = z.infer<typeof repoStateRulesSchema>;

// DTO returned by GET /repo-compliance/state-rules.
export const repoStateRulesDtoSchema = z.object({
  state: z.string(),
  rules: repoStateRulesSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RepoStateRulesDto = z.infer<typeof repoStateRulesDtoSchema>;
