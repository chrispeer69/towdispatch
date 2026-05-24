/**
 * Per-state statutory rule config for the self-help repossession compliance
 * workflow (Repo Compliance, Session 51). Ships all 50 states + DC in one
 * pass: the planned Session 49 (repo-core engine) and Session 50 (first 10
 * configs) never landed on master, so this module is self-contained — see
 * SESSION_51_DECISIONS.md.
 *
 * This module is the RUNTIME SOURCE OF TRUTH for the rule engine. The
 * repo_state_rules table (created + seeded in 0051_repo_compliance.sql)
 * mirrors these values so they are queryable / auditable; if the two ever
 * drift, code wins and a follow-up migration should re-seed. The migration
 * rows are generated directly from this config so the two cannot drift.
 *
 * ⚠️  LEGAL DISCLAIMER: the day-counts and posture flags below are best-effort
 * interpretations of each jurisdiction's repossession + UCC Article 9 +
 * consumer-credit statutes, researched against best available knowledge. They
 * are NOT legal advice and MUST be reviewed by counsel against the current
 * state code before any production repossession runs through this code. Each
 * block cites the governing statutes; see SESSION_51_DECISIONS.md for the
 * conservative-vs-aggressive choices.
 *
 * Conservative posture (applied where a statute is silent or ambiguous):
 *   - Breach-of-peace standard defaults to the UCC §9-609 baseline: "no force,
 *     no threat, no fraud, no breach of close."
 *   - Notices default to certified mail.
 *   - A post-repossession notice (UCC §9-611/§9-614) is required in every
 *     jurisdiction; we choose the longer redemption hold when ambiguous.
 *   - A pre-repossession right-to-cure notice is marked required only in
 *     states with a recognized consumer-credit right to cure (UCCC adopters +
 *     named retail-installment / motor-vehicle-finance acts). Verifying the
 *     precise cure-state list and day-counts is a standing counsel deferral.
 *   - Value tiers are a product heuristic (low ≤ $2,500, high ≥ $10,000) used
 *     to decide whether the engine bothers recommending a deficiency notice on
 *     low-value collateral; they are not statutory thresholds.
 */
import type { RepoState, RepoStateRules } from '@ustowdispatch/shared';

const BREACH_OF_PEACE_BASELINE = 'no force, no threat, no fraud, no breach of close (UCC 9-609)';

export const REPO_STATE_RULES: Record<RepoState, RepoStateRules> = {
  // --- Core 10 (highest repossession volume) ----------------------------

  // CA: self-help permitted; Rees-Levering requires a post-repossession NOI
  // with a 15-day reinstatement/redemption right and personal-property hold.
  CA: {
    statute: 'CA Comm. Code 9609/9611/9614/9616/9623; Civ. Code 2983.2-2983.3 (Rees-Levering)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 60,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // TX: self-help under Bus. & Com. Code Ch. 9; Finance Code Ch. 348 governs
  // motor-vehicle installment contracts. No general pre-repo cure notice.
  TX: {
    statute: 'TX Bus. & Com. Code 9.609/9.611/9.614/9.616/9.623; Fin. Code 348',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // FL: UCC Article 9 self-help; no statutory pre-repo cure notice.
  FL: {
    statute: 'FL Stat. 679.609/679.611/679.614/679.616/679.623 (UCC Art. 9)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // NY: UCC Article 9 self-help; Pers. Prop. Law Art. 9 (Motor Vehicle Retail
  // Installment Sales Act) governs consumer auto finance.
  NY: {
    statute: 'NY UCC 9-609/9-611/9-614/9-616/9-623; Pers. Prop. Law Art. 9 (MVRISA)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // GA: UCC Article 9 self-help; no statutory pre-repo cure notice.
  GA: {
    statute: 'GA Code 11-9-609/11-9-611/11-9-614/11-9-616/11-9-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // NC: Retail Installment Sales Act (Ch. 25A) gives a consumer right to cure
  // before repossession; reinstatement available.
  NC: {
    statute: 'NC Gen. Stat. 25-9-609/25-9-611/25-9-614/25-9-616/25-9-623; Ch. 25A (RISA)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 15,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // OH: UCC Article 9 self-help; Retail Installment Sales Act (R.C. 1317).
  OH: {
    statute: 'OH Rev. Code 1309.609/1309.611/1309.614/1309.616/1309.623; 1317 (RISA)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // IL: UCC Article 9 self-help; Motor Vehicle Retail Installment Sales Act
  // (815 ILCS 375).
  IL: {
    statute: 'IL 810 ILCS 5/9-609..9-623; 815 ILCS 375 (MV Retail Installment)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // PA: Motor Vehicle Sales Finance Act + Goodwin notice — a pre-repossession
  // notice and right to cure are required for covered consumer contracts.
  PA: {
    statute: 'PA 13 Pa.C.S. 9609/9611/9614/9616/9623; 12 P.S. 6251 (MVSFA) / Goodwin',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 15,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // MI: UCC Article 9 self-help; Motor Vehicle Sales Finance Act (MCL 492).
  MI: {
    statute: 'MI Comp. Laws 440.9609/440.9611/440.9614/440.9616/440.9623; 492.114',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },

  // --- Remaining 40 + DC (alphabetical) ---------------------------------

  // AK: UCC Article 9 self-help.
  AK: {
    statute: 'AK Stat. 45.29.609/45.29.611/45.29.614/45.29.616/45.29.623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // AL: UCC Article 9 self-help.
  AL: {
    statute: 'AL Code 7-9A-609/7-9A-611/7-9A-614/7-9A-616/7-9A-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // AR: UCC Article 9 self-help.
  AR: {
    statute: 'AR Code 4-9-609/4-9-611/4-9-614/4-9-616/4-9-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // AZ: UCC Article 9 self-help.
  AZ: {
    statute: 'AZ Rev. Stat. 47-9609/47-9611/47-9614/47-9616/47-9623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // CO: Uniform Consumer Credit Code — right-to-cure notice before repo.
  CO: {
    statute: 'CO Rev. Stat. 4-9-609..4-9-623; 5-5-110/5-5-111 (UCCC right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // CT: Retail Installment Sales Financing Act — pre-repo notice + right to cure.
  CT: {
    statute: 'CT Gen. Stat. 42a-9-609..42a-9-623; 36a-785 (retail installment)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 15,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // DC: Consumer Credit Protection Act — pre-repo notice + right to cure.
  DC: {
    statute: 'DC Code 28:9-609..28:9-623; 28-3812 (consumer credit right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 15,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // DE: UCC Article 9 self-help.
  DE: {
    statute: 'DE Code tit. 6 9-609/9-611/9-614/9-616/9-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // HI: UCC Article 9 self-help.
  HI: {
    statute: 'HI Rev. Stat. 490:9-609/490:9-611/490:9-614/490:9-616/490:9-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // IA: Iowa Consumer Credit Code — right-to-cure notice before repo.
  IA: {
    statute: 'IA Code 554.9609..554.9623; 537.5110/537.5111 (ICCC right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // ID: Idaho Credit Code (UCCC) — right-to-cure notice before repo.
  ID: {
    statute: 'ID Code 28-9-609..28-9-623; 28-45-110/28-45-111 (Credit Code cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // IN: Indiana Uniform Consumer Credit Code — right-to-cure notice before repo.
  IN: {
    statute: 'IN Code 26-1-9.1-609..623; 24-4.5-5-110/111 (IUCCC right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // KS: Kansas Uniform Consumer Credit Code — right-to-cure notice before repo.
  KS: {
    statute: 'KS Stat. 84-9-609..84-9-623; 16a-5-110/16a-5-111 (UCCC right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // KY: UCC Article 9 self-help.
  KY: {
    statute: 'KY Rev. Stat. 355.9-609/355.9-611/355.9-614/355.9-616/355.9-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // LA: Louisiana requires judicial or contractual self-help with notice; a
  // pre-repossession notice + cure window applies to consumer credit.
  LA: {
    statute: 'LA Rev. Stat. 10:9-609..10:9-623; 6:966 (Consumer Credit Law)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 10,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // MA: Ch. 255B §20B — pre-repossession right-to-cure notice (21 days).
  MA: {
    statute: 'MA Gen. Laws 106:9-609..9-623; 255B:20B (right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 21,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 21,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // MD: UCC Article 9 self-help; Credit Grantor Closed End Credit provisions
  // require a post-repossession notice with redemption.
  MD: {
    statute: 'MD Com. Law 9-609/9-611/9-614/9-616/9-623; 12-1021 (CLEC repossession)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // ME: Maine Consumer Credit Code (UCCC) — right-to-cure notice before repo.
  ME: {
    statute: 'ME Rev. Stat. tit. 11 9-1609..9-1623; tit. 9-A 5-110/5-111 (cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 14,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // MN: UCC Article 9 self-help; motor-vehicle retail installment sales act.
  MN: {
    statute: 'MN Stat. 336.9-609/336.9-611/336.9-614/336.9-616/336.9-623; 168.66 et seq',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // MO: Missouri requires a pre-repossession right-to-cure notice (§408.554).
  MO: {
    statute: 'MO Rev. Stat. 400.9-609..400.9-623; 408.554/408.555 (right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // MS: UCC Article 9 self-help.
  MS: {
    statute: 'MS Code 75-9-609/75-9-611/75-9-614/75-9-616/75-9-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // MT: UCC Article 9 self-help.
  MT: {
    statute: 'MT Code 30-9A-609/30-9A-611/30-9A-614/30-9A-616/30-9A-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // ND: UCC Article 9 self-help; retail installment sales redemption right.
  ND: {
    statute: 'ND Cent. Code 41-09-609..41-09-623; 51-13 (retail installment)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // NE: Nebraska Installment Sales / NUCCC — right-to-cure notice before repo.
  NE: {
    statute: 'NE Rev. Stat. 9-609..9-623 (UCC); 45-1,107 (NILB right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // NH: UCC Article 9 self-help; retail installment sales redemption right.
  NH: {
    statute: 'NH Rev. Stat. 382-A:9-609..9-623; 361-A (retail installment)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // NJ: UCC Article 9 self-help; Retail Installment Sales Act redemption.
  NJ: {
    statute: 'NJ Stat. 12A:9-609..12A:9-623; 17:16C (Retail Installment Sales Act)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // NM: UCC Article 9 self-help.
  NM: {
    statute: 'NM Stat. 55-9-609/55-9-611/55-9-614/55-9-616/55-9-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // NV: UCC Article 9 self-help.
  NV: {
    statute: 'NV Rev. Stat. 104.9609/104.9611/104.9614/104.9616/104.9623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // OK: Oklahoma Uniform Consumer Credit Code — right-to-cure notice before repo.
  OK: {
    statute: 'OK Stat. tit. 12A 1-9-609..623; tit. 14A 5-110/5-111 (UCCC cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // OR: UCC Article 9 self-help.
  OR: {
    statute: 'OR Rev. Stat. 79.0609/79.0611/79.0614/79.0616/79.0623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // RI: UCC Article 9 self-help; retail installment sales redemption right.
  RI: {
    statute: 'RI Gen. Laws 6A-9-609..6A-9-623; 6-27 (retail installment)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // SC: South Carolina Consumer Protection Code — right-to-cure before repo.
  SC: {
    statute: 'SC Code 36-9-609..36-9-623; 37-5-110/37-5-111 (Consumer Protection cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // SD: UCC Article 9 self-help.
  SD: {
    statute: 'SD Codified Laws 57A-9-609..57A-9-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // TN: UCC Article 9 self-help.
  TN: {
    statute: 'TN Code 47-9-609/47-9-611/47-9-614/47-9-616/47-9-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // UT: Utah Consumer Credit Code (UCCC) — right-to-cure notice before repo.
  UT: {
    statute: 'UT Code 70A-9a-609..623; 70C-7-101 et seq (Consumer Credit cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // VA: UCC Article 9 self-help.
  VA: {
    statute: 'VA Code 8.9A-609/8.9A-611/8.9A-614/8.9A-616/8.9A-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // VT: UCC Article 9 self-help; retail installment redemption right.
  VT: {
    statute: 'VT Stat. tit. 9A 9-609..9-623; tit. 9 2455 (retail installment)',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // WA: UCC Article 9 self-help; RCW 62A.9A redemption right.
  WA: {
    statute: 'WA Rev. Code 62A.9A-609/62A.9A-611/62A.9A-614/62A.9A-616/62A.9A-623',
    preRepoNoticeRequired: false,
    preRepoNoticeDays: 0,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: false,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // WI: Wisconsin Consumer Act — pre-repo notice + right to cure (no breach of
  // peace; many consumer repos require judicial action). Cure period 15 days.
  WI: {
    statute: 'WI Stat. 409.609..409.623; 425.104/425.105 (Consumer Act right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 15,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // WV: Consumer Credit and Protection Act — right-to-cure notice before repo.
  WV: {
    statute: 'WV Code 46-9-609..46-9-623; 46A-2-106 (CCPA right to cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // WY: Wyoming Uniform Consumer Credit Code — right-to-cure notice before repo.
  WY: {
    statute: 'WY Stat. 34.1-9-609..34.1-9-623; 40-14-521/40-14-522 (UCCC cure)',
    preRepoNoticeRequired: true,
    preRepoNoticeDays: 20,
    breachOfPeaceStandard: BREACH_OF_PEACE_BASELINE,
    certifiedNoticeRequired: true,
    postRepoNoticeDays: 10,
    redemptionDays: 15,
    personalPropertyHoldDays: 30,
    reinstatementRight: true,
    deficiencyNoticeRequired: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
};
