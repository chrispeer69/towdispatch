/**
 * Repo Compliance — per-state self-help repossession rule contract.
 *
 * `RepoStateRules` is the jsonb shape stored in repo_state_rules.rules and the
 * typed config the rule engine reads (state-rules.config.ts in the API is the
 * runtime source of truth). Session 51 ships all 50 states + DC in a single
 * pass: the planned Session 49 (repo-core) and Session 50 (first 10 configs)
 * never landed on master, so this module is self-contained — see
 * SESSION_51_DECISIONS.md.
 *
 * The model is UCC Article 9 self-help repossession (§9-609 breach-of-peace
 * standard, §9-611/§9-614 post-repossession notice, §9-616 deficiency
 * explanation, §9-623 redemption), overlaid with each state's consumer-credit
 * right-to-cure rules. Day-counts are best-effort against each jurisdiction's
 * statute and require legal review before production use — see
 * SESSION_51_DECISIONS.md for the conservative-posture choices.
 */
import { z } from 'zod';

// All 50 states + DC. Session 51 shipped the full set at once (no S50 base to
// extend). Ordered to mirror the lien module: a leading "core 10" block, then
// the remainder alphabetically — purely for diff-friendliness, not behavior.
export const repoStateValues = [
  // Core 10 (highest repossession volume).
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
  // Remaining 40 + DC (alphabetical).
  'AK',
  'AL',
  'AR',
  'AZ',
  'CO',
  'CT',
  'DC',
  'DE',
  'HI',
  'IA',
  'ID',
  'IN',
  'KS',
  'KY',
  'LA',
  'MA',
  'MD',
  'ME',
  'MN',
  'MO',
  'MS',
  'MT',
  'ND',
  'NE',
  'NH',
  'NJ',
  'NM',
  'NV',
  'OK',
  'OR',
  'RI',
  'SC',
  'SD',
  'TN',
  'UT',
  'VA',
  'VT',
  'WA',
  'WI',
  'WV',
  'WY',
] as const;
export type RepoState = (typeof repoStateValues)[number];

export const repoValueTierValues = ['low', 'mid', 'high'] as const;
export type RepoValueTier = (typeof repoValueTierValues)[number];

// Value-tier boundaries (cents). low: value <= lowMaxCents; high: value >=
// highMinCents; mid: in between. Tier is a PRODUCT heuristic, not a statutory
// figure: it gates whether the engine bothers recommending a deficiency
// notice (rarely pursued on low-value collateral). See SESSION_51_DECISIONS.md.
export const repoValueTiersSchema = z.object({
  lowMaxCents: z.number().int().min(0),
  highMinCents: z.number().int().min(0),
});
export type RepoValueTiers = z.infer<typeof repoValueTiersSchema>;

export const repoStateRulesSchema = z.object({
  // Statutory citation. Best-effort; verify against current state code.
  statute: z.string(),
  // Whether a pre-repossession Notice of Default + Right to Cure must be sent
  // before self-help repossession (a consumer-credit right in cure states).
  preRepoNoticeRequired: z.boolean(),
  // Days the right-to-cure notice must give the debtor before repossession.
  // 0 when no pre-repo notice is required.
  preRepoNoticeDays: z.number().int().min(0),
  // The UCC §9-609 self-help standard governing the repossession itself.
  breachOfPeaceStandard: z.string(),
  // Whether post-repossession notices must go certified (conservative default).
  certifiedNoticeRequired: z.boolean(),
  // Days a sent post-repossession Notice of Intent to dispose (§9-611/§9-614)
  // must precede disposition — the "reasonable notification" lead window
  // (§9-612 sets a 10-day safe harbor for consumer transactions).
  postRepoNoticeDays: z.number().int().min(0),
  // The debtor's redemption window after repossession before disposition
  // may proceed (§9-623).
  redemptionDays: z.number().int().min(0),
  // Days the operator must hold personal property recovered from the vehicle.
  personalPropertyHoldDays: z.number().int().min(0),
  // Whether the debtor has a statutory reinstatement (cure-and-continue) right
  // in addition to redemption.
  reinstatementRight: z.boolean(),
  // Whether a post-disposition explanation/notice of deficiency is required
  // (§9-616, consumer-goods transactions).
  deficiencyNoticeRequired: z.boolean(),
  valueTiers: repoValueTiersSchema,
});
export type RepoStateRules = z.infer<typeof repoStateRulesSchema>;

// DTO shape for a per-state rule row (mirrors repo_state_rules).
export const repoStateRulesDtoSchema = z.object({
  state: z.string(),
  rules: repoStateRulesSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RepoStateRulesDto = z.infer<typeof repoStateRulesDtoSchema>;
