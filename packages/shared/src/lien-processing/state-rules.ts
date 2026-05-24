/**
 * Lien Processing — per-state statutory rule contract.
 *
 * `LienStateRules` is the jsonb shape stored in lien_state_rules.rules and
 * the typed config the rule engine reads (state-rules.config.ts in the API
 * is the runtime source of truth). Session 23 shipped the top 10 states (CA,
 * TX, FL, NY, GA, NC, OH, IL, PA, MI); Session 35 added the remaining 40 + DC
 * for full 50-state + DC coverage.
 *
 * Day-counts are best-effort against each jurisdiction's lien-sale statute and
 * require legal review before production use — see SESSION_23_DECISIONS.md
 * (top 10) and SESSION_35_DECISIONS.md (remaining 40 + DC).
 */
import { z } from 'zod';

// All 50 states + DC. The first 10 were shipped in Session 23; the remaining
// 40 + DC were added in Session 35. Sorted alphabetically within each group.
export const lienStateValues = [
  // Session 23 — top 10.
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
  // Session 35 — remaining 40 + DC (alphabetical).
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
export type LienState = (typeof lienStateValues)[number];

export const lienValueTierValues = ['low', 'mid', 'high'] as const;
export type LienValueTier = (typeof lienValueTierValues)[number];

// Value-tier boundaries (cents). low: value <= lowMaxCents; high: value >=
// highMinCents; mid: in between. Low-value vehicles are often exempt from
// publication, which `lowValuePublicationExempt` controls.
export const lienValueTiersSchema = z.object({
  lowMaxCents: z.number().int().min(0),
  highMinCents: z.number().int().min(0),
});
export type LienValueTiers = z.infer<typeof lienValueTiersSchema>;

export const lienStateRulesSchema = z.object({
  // Statutory citation. Best-effort; verify against current state code.
  statute: z.string(),
  // Days after opening to complete the DMV owner/lienholder lookup.
  dmvLookupWindowDays: z.number().int().min(0),
  // Days to wait for an owner response after the owner notice is sent.
  ownerNoticeWaitDays: z.number().int().min(0),
  // Days to wait for a lienholder response after the lienholder notice.
  lienholderNoticeWaitDays: z.number().int().min(0),
  // Whether newspaper publication is required (subject to value-tier exemption).
  publicationRequired: z.boolean(),
  // Days after publication before a sale may proceed.
  publicationWaitDays: z.number().int().min(0),
  // Minimum total days from opening to the earliest legal sale date.
  minDaysToSale: z.number().int().min(0),
  // When true, low-value vehicles skip the publication requirement.
  lowValuePublicationExempt: z.boolean(),
  valueTiers: lienValueTiersSchema,
});
export type LienStateRules = z.infer<typeof lienStateRulesSchema>;

// DTO returned by GET /lien-cases/state-rules.
export const lienStateRulesDtoSchema = z.object({
  state: z.string(),
  rules: lienStateRulesSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LienStateRulesDto = z.infer<typeof lienStateRulesDtoSchema>;
