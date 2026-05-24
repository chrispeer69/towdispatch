/**
 * Per-state statutory rule config for the lien-sale workflow (Lien
 * Processing, Session 23).
 *
 * This module is the RUNTIME SOURCE OF TRUTH for the rule engine. The
 * lien_state_rules table (seeded in 0038_lien_processing.sql) mirrors these
 * values so they are queryable / auditable; if the two ever drift, code
 * wins and a follow-up migration should re-seed.
 *
 * ⚠️  LEGAL DISCLAIMER: the day-counts and value thresholds below are
 * best-effort interpretations of each state's lien-sale statute, researched
 * against best available knowledge. They are NOT legal advice and MUST be
 * reviewed by counsel against the current state code before any production
 * lien sale runs through this code. Each block cites the governing statute;
 * see SESSION_23_DECISIONS.md for the conservative-vs-aggressive choices.
 */
import type { LienState, LienStateRules } from '@ustowdispatch/shared';

export const LIEN_STATE_RULES: Record<LienState, LienStateRules> = {
  // Statute: CA Civil Code §3068.1 / Vehicle Code §22851.12 (lien sale),
  // §22851.10 (low-value < $4,000 expedited) — verify against current code.
  // Conservative: 30-day floor to sale, publication for mid/high value.
  CA: {
    statute: 'CA Civil Code 3068.1 / Vehicle Code 22851.12, 22851.10 (low-value)',
    dmvLookupWindowDays: 3,
    ownerNoticeWaitDays: 10,
    lienholderNoticeWaitDays: 10,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 400_000, highMinCents: 1_000_000 },
  },
  // Statute: TX Occupations Code Ch. 2303 / Property Code §70.006 —
  // verify against current code. TX relies on certified notice rather than
  // newspaper publication for storage liens.
  TX: {
    statute: 'TX Occupations Code 2303 / Property Code 70.006',
    dmvLookupWindowDays: 5,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: FL Statutes §713.78 (wrecker/storage lien) / §713.585 —
  // verify against current code. FL requires publication regardless of
  // value, hence lowValuePublicationExempt = false (conservative).
  FL: {
    statute: 'FL Statutes 713.78 / 713.585',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 35,
    lowValuePublicationExempt: false,
    valueTiers: { lowMaxCents: 300_000, highMinCents: 1_000_000 },
  },
  // Statute: NY Lien Law §184 (garagekeeper's lien) / §200-204 sale —
  // verify against current code.
  NY: {
    statute: 'NY Lien Law 184 / 200-204',
    dmvLookupWindowDays: 5,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 150_000, highMinCents: 1_000_000 },
  },
  // Statute: GA Code §40-11-1..19 (abandoned vehicles) / §44-1-13 —
  // verify against current code.
  GA: {
    statute: 'GA Code 40-11-1 through 40-11-19 / 44-1-13',
    dmvLookupWindowDays: 5,
    ownerNoticeWaitDays: 10,
    lienholderNoticeWaitDays: 10,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: NC Gen Stat Ch. 44A Art. 1 (§44A-1..4, possessory liens) —
  // verify against current code.
  NC: {
    statute: 'NC Gen Stat 44A-1 through 44A-4 (Chapter 44A Article 1)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 10,
    lienholderNoticeWaitDays: 10,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 300_000, highMinCents: 1_000_000 },
  },
  // Statute: OH Rev Code §4505.101 (unclaimed-vehicle title) / §4513.60-.62
  // — verify against current code. OH uses certified notice, no publication.
  OH: {
    statute: 'OH Rev Code 4505.101 / 4513.60-.62',
    dmvLookupWindowDays: 5,
    ownerNoticeWaitDays: 15,
    lienholderNoticeWaitDays: 15,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: IL 625 ILCS 5/4-201..214 (disposal of abandoned vehicles) /
  // 770 ILCS 50 (labor & storage lien) — verify against current code.
  IL: {
    statute: 'IL 625 ILCS 5/4-201 through 5/4-214 / 770 ILCS 50',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 15,
    lienholderNoticeWaitDays: 15,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: PA 75 Pa.C.S. §7301-7305 (abandoned vehicles) — verify against
  // current code.
  PA: {
    statute: 'PA 75 Pa.C.S. 7301-7305 / Abandoned Vehicle provisions',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 15,
    lienholderNoticeWaitDays: 15,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: MI Comp Laws §257.252 (abandoned vehicles) / §570.521-.530
  // (lien on vehicles) — verify against current code.
  MI: {
    statute: 'MI Comp Laws 257.252 / 570.521-570.530',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
};

export function getStateRules(state: string): LienStateRules | null {
  return (LIEN_STATE_RULES as Record<string, LienStateRules>)[state] ?? null;
}
