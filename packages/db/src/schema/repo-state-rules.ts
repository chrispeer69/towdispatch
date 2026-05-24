/**
 * repo_state_rules — per-state statutory rule config for the repossession
 * compliance engine (Repo Compliance, Session 50).
 *
 * GLOBAL reference data: NOT tenant-scoped, no RLS. The TypeScript module
 * apps/api/src/modules/repo/compliance/state-rules.config.ts is the runtime
 * source of truth; this table mirrors it (seeded in the migration) so the
 * values are queryable and a future session can let tenants override.
 *
 * The jsonb shape is kept structurally in sync with `RepoStateRules` in
 * @ustowdispatch/shared; it is declared locally here because the db schema
 * package is self-contained (it does not import shared) — same convention as
 * the lien / impound schema files.
 *
 * Defined in packages/db/sql/0051_repo_compliance.sql.
 */
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export interface RepoStateRulesJson {
  statute: string;
  peacefulRepoDefinition: string;
  preRepoNoticeRequired: boolean;
  preRepoNoticeDays: number;
  postRepoNoticeRequired: boolean;
  postRepoNoticeDays: number;
  postRepoNoticeMethod: string;
  redemptionPeriodDays: number;
  cureRight: boolean;
  cureRightDays: number;
  personalPropertyHoldDays: number;
  personalPropertyReleaseMethod: string;
  secondaryContactRequired: boolean;
  sheriffNoticeRequired: boolean;
  sheriffNoticeJurisdiction: string | null;
  nightRepoIsBreach: boolean;
  presenceObjectionStrict: boolean;
}

export const repoStateRules = pgTable('repo_state_rules', {
  state: text('state').primaryKey(),
  rules: jsonb('rules').$type<RepoStateRulesJson>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RepoStateRuleRow = typeof repoStateRules.$inferSelect;
export type NewRepoStateRuleRow = typeof repoStateRules.$inferInsert;
