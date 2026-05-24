/**
 * Per-state repossession-compliance rule config (Repo Compliance, Session 50).
 *
 * This module is the RUNTIME SOURCE OF TRUTH for the rule engine. The
 * repo_state_rules table (seeded in 0051_repo_compliance.sql) mirrors these
 * values so they are queryable / auditable; if the two ever drift, code wins
 * and a follow-up migration should re-seed (same convention as the lien
 * module's state-rules.config.ts).
 *
 * ⚠️  LEGAL DISCLAIMER: repossession is governed by UCC §9-609 (self-help is
 * permitted only WITHOUT a breach of the peace) plus each state's deficiency /
 * redemption / personal-property statutes. The day-counts and flags below are
 * best-effort interpretations researched against best available knowledge.
 * They are NOT legal advice and MUST be reviewed by counsel against the
 * current state code before any production repossession runs through this
 * code. Each block cites the governing statute; see SESSION_50_DECISIONS.md
 * for the conservative-vs-aggressive choices.
 *
 * Posture: where a statute's exact day-count is ambiguous we choose the longer
 * hold / extra notice / stricter breach test — the choice that better protects
 * the debtor and is the safer default for an operator. Where a state grants
 * only a POST-sale right (not a pre-sale redemption window) we set
 * redemptionPeriodDays = 0 and rely on the cure right; we do not invent a
 * redemption window.
 *
 * Session 50 ships the top 10 states (CA, TX, FL, NY, GA, NC, OH, IL, PA, MI);
 * the remaining 40 + DC are deferred to Session 51 — append them here and the
 * engine / tables / tests pick them up automatically (repoStateValues is the
 * single lever).
 */
import type { RepoState, RepoStateRules } from '@ustowdispatch/shared';

const UCC_BREACH =
  'Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action).';

export const REPO_STATE_RULES: Record<RepoState, RepoStateRules> = {
  // Statute: CA Civil Code §2983.2/§2983.3 (Rees-Levering) + §7507.x
  // (repossession agency act). 48-hour post-repo notice; 15-day redemption /
  // reinstatement; consumer-protection posture → 60-day personal-property hold
  // and a secondary-contact notice. Verify against current code.
  CA: {
    statute: 'CA Civil Code 2983.2 / 2983.3 (Rees-Levering) / 7507.x',
    peacefulRepoDefinition: `${UCC_BREACH} California additionally regulates repossession agencies (Bus. & Prof. Code 7500 et seq.).`,
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 2,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 15,
    cureRight: true,
    cureRightDays: 15,
    personalPropertyHoldDays: 60,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: true,
    sheriffNoticeRequired: false,
    sheriffNoticeJurisdiction: null,
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
  // Statute: TX Bus. & Com. Code §9.609 (UCC) + Finance Code Ch. 348 (motor
  // vehicle installment sales). Post-sale deficiency, no statutory pre-sale
  // redemption window; 10-day cure. Verify against current code.
  TX: {
    statute: 'TX Bus. & Com. Code 9.609 / Finance Code Ch. 348',
    peacefulRepoDefinition: UCC_BREACH,
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 5,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 0,
    cureRight: true,
    cureRightDays: 10,
    personalPropertyHoldDays: 30,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: false,
    sheriffNoticeRequired: false,
    sheriffNoticeJurisdiction: null,
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
  // Statute: FL Statutes §679.609 (UCC self-help) + §493 (recovery agents).
  // Post-sale deficiency; 10-day notice; 10-day cure. Verify against current code.
  FL: {
    statute: 'FL Statutes 679.609 / 493 (recovery agents)',
    peacefulRepoDefinition: `${UCC_BREACH} Florida licenses recovery agents under ch. 493.`,
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 10,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 0,
    cureRight: true,
    cureRightDays: 10,
    personalPropertyHoldDays: 30,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: false,
    sheriffNoticeRequired: false,
    sheriffNoticeJurisdiction: null,
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
  // Statute: NY UCC §9-609 + Banking Law §108 (retail installment).
  // 15-day redemption; certified notice; secondary-contact posture (co-buyer).
  // Verify against current code.
  NY: {
    statute: 'NY UCC 9-609 / Banking Law 108',
    peacefulRepoDefinition: UCC_BREACH,
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 10,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 15,
    cureRight: true,
    cureRightDays: 15,
    personalPropertyHoldDays: 45,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: true,
    sheriffNoticeRequired: false,
    sheriffNoticeJurisdiction: null,
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
  // Statute: GA OCGA §11-9-609 (UCC) + §10-1-36 (motor vehicle sales
  // deficiency notice). Post-sale deficiency; 10-day notice. Verify against
  // current code.
  GA: {
    statute: 'GA OCGA 11-9-609 / 10-1-36',
    peacefulRepoDefinition: UCC_BREACH,
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 10,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 0,
    cureRight: true,
    cureRightDays: 10,
    personalPropertyHoldDays: 30,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: false,
    sheriffNoticeRequired: false,
    sheriffNoticeJurisdiction: null,
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
  // Statute: NC Gen. Stat. §25-9-609 (UCC) + §20-102.1 (report of
  // repossession to local law enforcement to clear stolen-vehicle reports).
  // 15-day cure. Verify against current code.
  NC: {
    statute: 'NC Gen. Stat. 25-9-609 / 20-102.1 (LE report)',
    peacefulRepoDefinition: `${UCC_BREACH} North Carolina requires reporting the repossession to local law enforcement (G.S. 20-102.1).`,
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 10,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 0,
    cureRight: true,
    cureRightDays: 15,
    personalPropertyHoldDays: 30,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: false,
    sheriffNoticeRequired: true,
    sheriffNoticeJurisdiction: 'local law enforcement',
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
  // Statute: OH Rev. Code §1309.609 (UCC) + §1317.12 (retail installment
  // right-to-cure). OH requires a notice-of-default / right-to-cure BEFORE
  // repossession → preRepoNoticeRequired. Verify against current code.
  OH: {
    statute: 'OH Rev. Code 1309.609 / 1317.12 (right-to-cure)',
    peacefulRepoDefinition: UCC_BREACH,
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 10,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 10,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 0,
    cureRight: true,
    cureRightDays: 10,
    personalPropertyHoldDays: 30,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: false,
    sheriffNoticeRequired: false,
    sheriffNoticeJurisdiction: null,
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
  // Statute: IL 810 ILCS 5/9-609 (UCC) + 815 ILCS 375 (Motor Vehicle Retail
  // Installment Sales Act). 21-day cure (conservative). Verify against current
  // code.
  IL: {
    statute: 'IL 810 ILCS 5/9-609 / 815 ILCS 375',
    peacefulRepoDefinition: UCC_BREACH,
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 10,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 0,
    cureRight: true,
    cureRightDays: 21,
    personalPropertyHoldDays: 30,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: false,
    sheriffNoticeRequired: false,
    sheriffNoticeJurisdiction: null,
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
  // Statute: PA 13 Pa.C.S. §9609 (UCC) + 69 P.S. §623 (Motor Vehicle Sales
  // Finance Act). PA requires a 15-day notice / right-to-cure before
  // repossession and a 15-day redemption window. Verify against current code.
  PA: {
    statute: 'PA 13 Pa.C.S. 9609 / 69 P.S. 623 (MVSFA)',
    peacefulRepoDefinition: UCC_BREACH,
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 15,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 15,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 15,
    cureRight: true,
    cureRightDays: 15,
    personalPropertyHoldDays: 30,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: true,
    sheriffNoticeRequired: false,
    sheriffNoticeJurisdiction: null,
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
  // Statute: MI MCL §440.9609 (UCC) + §492.114a (Motor Vehicle Sales Finance
  // Act). Post-sale deficiency; 10-day notice. Verify against current code.
  MI: {
    statute: 'MI MCL 440.9609 / 492.114a',
    peacefulRepoDefinition: UCC_BREACH,
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    postRepoNoticeRequired: true,
    postRepoNoticeDays: 10,
    postRepoNoticeMethod: 'certified',
    redemptionPeriodDays: 0,
    cureRight: true,
    cureRightDays: 10,
    personalPropertyHoldDays: 30,
    personalPropertyReleaseMethod: 'owner_pickup_after_notice',
    secondaryContactRequired: false,
    sheriffNoticeRequired: false,
    sheriffNoticeJurisdiction: null,
    nightRepoIsBreach: false,
    presenceObjectionStrict: true,
  },
};

export function getRepoStateRules(state: string): RepoStateRules | null {
  return (REPO_STATE_RULES as Record<string, RepoStateRules>)[state] ?? null;
}
