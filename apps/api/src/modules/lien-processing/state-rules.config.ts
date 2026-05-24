/**
 * Per-state statutory rule config for the lien-sale workflow (Lien
 * Processing). Session 23 shipped the top 10 states (CA, TX, FL, NY, GA, NC,
 * OH, IL, PA, MI); Session 35 added the remaining 40 + DC for full 50-state
 * + DC coverage.
 *
 * This module is the RUNTIME SOURCE OF TRUTH for the rule engine. The
 * lien_state_rules table (seeded in 0038_lien_processing.sql for the top 10
 * and 0044_lien_remaining_states.sql for the remaining 40 + DC) mirrors these
 * values so they are queryable / auditable; if the two ever drift, code wins
 * and a follow-up migration should re-seed.
 *
 * ⚠️  LEGAL DISCLAIMER: the day-counts and value thresholds below are
 * best-effort interpretations of each jurisdiction's lien-sale statute,
 * researched against best available knowledge. They are NOT legal advice and
 * MUST be reviewed by counsel against the current state code before any
 * production lien sale runs through this code. Each block cites the governing
 * statute; see SESSION_23_DECISIONS.md (top 10) and SESSION_35_DECISIONS.md
 * (remaining 40 + DC) for the conservative-vs-aggressive choices.
 *
 * Posture for the Session 35 additions: where a statute's exact day-count or
 * publication mechanism is ambiguous we choose the longer hold / extra notice
 * (the choice that better protects the owner and is the safer default for an
 * operator). Value tiers are a product heuristic (low ≤ $2,500 default, high
 * ≥ $10,000) used to gate the low-value publication exemption, not a statutory
 * figure, unless a state's code sets an explicit low-value threshold.
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

  // ===================================================================
  // Session 35 — remaining 40 states + DC (alphabetical).
  // ===================================================================

  // Statute: AK Stat. 28.10.471 / 28.10.502 (abandoned) / 34.35.165
  // (storage lien). Remote state, certified-mail process, no newspaper
  // publication; conservative 45-day hold given long owner-contact times.
  AK: {
    statute: 'AK Stat. 28.10.471 / 28.10.502 / 34.35.165 (storage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: AL Code 32-13-1 et seq (abandoned motor vehicles) / 35-11-110
  // (garage/storage lien). Publication + 45-day hold (conservative).
  AL: {
    statute: 'AL Code 32-13-1 et seq / 35-11-110 (garage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: AR Code 27-50-1201 et seq (abandoned) / 18-45-201 (laborer's &
  // storage lien). Publication + 45-day hold (conservative).
  AR: {
    statute: 'AR Code 27-50-1201 et seq / 18-45-201 (storage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: AZ Rev. Stat. 28-4801 et seq (abandoned vehicles, ADOT process)
  // / 33-1022. ADOT abandoned-vehicle reporting + certified notice; no
  // newspaper publication.
  AZ: {
    statute: 'AZ Rev. Stat. 28-4801 et seq / 33-1022 (ADOT abandoned)',
    dmvLookupWindowDays: 5,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: CO Rev. Stat. 42-4-2101 et seq (abandoned vehicles) /
  // 42-4-2103. Certified notice to owner/lienholder of record; no newspaper
  // publication required.
  CO: {
    statute: 'CO Rev. Stat. 42-4-2101 et seq / 42-4-2103 (abandoned)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: CT Gen. Stat. 14-150 (abandoned/unclaimed) / 14-66 (storage
  // lien). Publication + 45-day hold (conservative; CT release windows vary).
  CT: {
    statute: 'CT Gen. Stat. 14-150 / 14-66 (storage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 15,
    lienholderNoticeWaitDays: 15,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: DC Code 50-2421.01 et seq (abandoned & dangerous vehicles).
  // Publication + 45-day hold (conservative for the District process).
  DC: {
    statute: 'DC Code 50-2421.01 et seq (abandoned & junk vehicles)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: DE Code tit. 21 4406 (abandoned) / tit. 25 3901 (garage keeper
  // lien). Publication + 45-day hold (conservative).
  DE: {
    statute: 'DE Code tit. 21 4406 / tit. 25 3901 (garage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: HI Rev. Stat. 290-1 et seq (abandoned vehicles) / 507-18
  // (storage lien). Island logistics → longest hold (60) + 15-day
  // publication window (conservative).
  HI: {
    statute: 'HI Rev. Stat. 290-1 et seq / 507-18 (storage lien)',
    dmvLookupWindowDays: 10,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 15,
    minDaysToSale: 60,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: IA Code 321.89 / 321.90 (abandoned vehicles). Certified notice
  // to owner/lienholder; no newspaper publication required.
  IA: {
    statute: 'IA Code 321.89 / 321.90 (abandoned vehicles)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: ID Code 49-1801 et seq (abandoned) / 45-805 (possessory lien).
  // Publication + 30-day hold.
  ID: {
    statute: 'ID Code 49-1801 et seq / 45-805 (possessory lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 25,
    lienholderNoticeWaitDays: 25,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: IN Code 9-22-1 et seq (abandoned vehicles) / 32-33-10
  // (possessory lien). BMV abandoned-vehicle process; certified notice, no
  // newspaper publication.
  IN: {
    statute: 'IN Code 9-22-1 et seq / 32-33-10 (possessory lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 25,
    lienholderNoticeWaitDays: 25,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: KS Stat. 8-1102 / 8-1103 (abandoned/storage lien). Publication
  // + 30-day hold.
  KS: {
    statute: 'KS Stat. 8-1102 / 8-1103 (abandoned/storage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 15,
    lienholderNoticeWaitDays: 15,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: KY Rev. Stat. 376.270 / 376.275 (storage lien & enforcement).
  // Publication + 45-day hold (conservative).
  KY: {
    statute: 'KY Rev. Stat. 376.270 / 376.275 (storage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: LA Rev. Stat. 32:1711 et seq (abandoned) / 9:4501 (lien on
  // vehicles). Publication + longest-tier 60-day hold (conservative).
  LA: {
    statute: 'LA Rev. Stat. 32:1711 et seq / 9:4501 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 15,
    minDaysToSale: 60,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: MA Gen. Laws ch. 90 31A (abandoned) / ch. 255 39A (garage
  // keeper lien). Strictest lienholder timeline here: 45-day lienholder
  // wait, publication + 14-day window, 45-day hold (conservative).
  MA: {
    statute: 'MA Gen. Laws ch. 90 31A / ch. 255 39A (garage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 45,
    publicationRequired: true,
    publicationWaitDays: 14,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: MD Transp. 25-201 et seq (abandoned) / Com. Law 16-201 (garage
  // keeper lien). Publication + 45-day hold (conservative).
  MD: {
    statute: 'MD Transp. 25-201 et seq / Com. Law 16-201 (garage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: ME Rev. Stat. tit. 29-A 1351 et seq (abandoned) / tit. 10 3801
  // (storage lien). Publication + 30-day hold.
  ME: {
    statute: 'ME Rev. Stat. tit. 29-A 1351 et seq / tit. 10 3801',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: MN Stat. 168B.01 et seq (abandoned vehicles) / 514.18 (lien).
  // Certified notice; no newspaper publication required.
  MN: {
    statute: 'MN Stat. 168B.01 et seq / 514.18 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: MO Rev. Stat. 304.155 et seq (abandoned) / 430.082 (towing &
  // storage lien). Certified notice; no newspaper publication required.
  MO: {
    statute: 'MO Rev. Stat. 304.155 et seq / 430.082 (towing lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: MS Code 63-23-1 et seq (abandoned) / 85-7-251 (lien). Publication
  // + 45-day hold (conservative).
  MS: {
    statute: 'MS Code 63-23-1 et seq / 85-7-251 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: MT Code 61-12-401 et seq (abandoned) / 71-3-1201 (lien).
  // Publication + 30-day hold.
  MT: {
    statute: 'MT Code 61-12-401 et seq / 71-3-1201 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: ND Cent. Code 39-26-01 et seq (abandoned) / 35-13-01 (lien).
  // Publication + 30-day hold.
  ND: {
    statute: 'ND Cent. Code 39-26-01 et seq / 35-13-01 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: NE Rev. Stat. 60-1901 et seq (abandoned) / 52-601.01 (lien).
  // Publication + 30-day hold.
  NE: {
    statute: 'NE Rev. Stat. 60-1901 et seq / 52-601.01 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: NH Rev. Stat. 262:31 et seq (abandoned) / 450:1 (garage lien).
  // Publication + 45-day hold (conservative).
  NH: {
    statute: 'NH Rev. Stat. 262:31 et seq / 450:1 (garage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 25,
    lienholderNoticeWaitDays: 25,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: NJ Stat. 39:10A-1 et seq (abandoned) / 2A:44-20 (garage keeper
  // lien). Publication + 45-day hold (conservative).
  NJ: {
    statute: 'NJ Stat. 39:10A-1 et seq / 2A:44-20 (garage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: NM Stat. 66-3-1 et seq (titling/abandoned) / 48-3-19 (lien).
  // Publication + 30-day hold.
  NM: {
    statute: 'NM Stat. 66-3-1 et seq / 48-3-19 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: NV Rev. Stat. 487.230 et seq (abandoned) / 108.270 (storage
  // lien). Certified notice; no newspaper publication required.
  NV: {
    statute: 'NV Rev. Stat. 487.230 et seq / 108.270 (storage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: OK Stat. tit. 47 901 et seq (abandoned) / tit. 42 91A (lien).
  // Publication + 45-day hold (conservative).
  OK: {
    statute: 'OK Stat. tit. 47 901 et seq / tit. 42 91A (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: OR Rev. Stat. 819.100 et seq (abandoned) / 98.812 (towed
  // vehicle). Certified notice; no newspaper publication required.
  OR: {
    statute: 'OR Rev. Stat. 819.100 et seq / 98.812 (towed vehicle)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: RI Gen. Laws 31-43-1 et seq (abandoned) / 34-47-1 (garage
  // lien). Publication + 45-day hold (conservative).
  RI: {
    statute: 'RI Gen. Laws 31-43-1 et seq / 34-47-1 (garage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: SC Code 56-5-5630 et seq (abandoned) / 29-15-10 (lien).
  // Publication + 45-day hold (conservative; SC magistrate process).
  SC: {
    statute: 'SC Code 56-5-5630 et seq / 29-15-10 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: SD Codified Laws 32-30-1 et seq (abandoned) / 32-36 (lien).
  // Publication + 30-day hold.
  SD: {
    statute: 'SD Codified Laws 32-30-1 et seq / 32-36 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: TN Code 55-16-101 et seq (abandoned) / 66-19-103 (garage
  // keeper lien). Certified notice; no newspaper publication required.
  TN: {
    statute: 'TN Code 55-16-101 et seq / 66-19-103 (garage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: UT Code 41-6a-1401 et seq (abandoned) / 72-9-603 / 38-2-1
  // (lien). Publication + 30-day hold.
  UT: {
    statute: 'UT Code 41-6a-1401 et seq / 72-9-603 / 38-2-1 (lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: VA Code 46.2-1200 et seq (abandoned/unclaimed) / 43-32 (garage
  // keeper lien). Publication + 45-day hold (conservative).
  VA: {
    statute: 'VA Code 46.2-1200 et seq / 43-32 (garage lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: VT Stat. tit. 23 2151 et seq (abandoned) / tit. 9 1961 (lien).
  // Publication + 30-day hold.
  VT: {
    statute: 'VT Stat. tit. 23 2151 et seq / tit. 9 1961 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: WA Rev. Code 46.55 (towing & impound) / 60.10 (chattel lien).
  // Registered tow-truck operator process: certified notice, no newspaper
  // publication; shortest waits in the set (15-day notice, 30-day hold).
  WA: {
    statute: 'WA Rev. Code 46.55 / 60.10 (impound & chattel lien)',
    dmvLookupWindowDays: 5,
    ownerNoticeWaitDays: 15,
    lienholderNoticeWaitDays: 15,
    publicationRequired: false,
    publicationWaitDays: 0,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: WI Stat. 342.40 (abandoned) / 779.41 (towing & storage lien).
  // Publication + 30-day hold.
  WI: {
    statute: 'WI Stat. 342.40 / 779.41 (towing lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 20,
    lienholderNoticeWaitDays: 20,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 30,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: WV Code 17-24-1 et seq (abandoned) / 38-13-1 (lien). Publication
  // + 45-day hold (conservative).
  WV: {
    statute: 'WV Code 17-24-1 et seq / 38-13-1 (vehicle lien)',
    dmvLookupWindowDays: 7,
    ownerNoticeWaitDays: 30,
    lienholderNoticeWaitDays: 30,
    publicationRequired: true,
    publicationWaitDays: 10,
    minDaysToSale: 45,
    lowValuePublicationExempt: true,
    valueTiers: { lowMaxCents: 250_000, highMinCents: 1_000_000 },
  },
  // Statute: WY Stat. 31-13-101 et seq (abandoned) / 29-7-101 (lien).
  // Publication + 30-day hold.
  WY: {
    statute: 'WY Stat. 31-13-101 et seq / 29-7-101 (vehicle lien)',
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
