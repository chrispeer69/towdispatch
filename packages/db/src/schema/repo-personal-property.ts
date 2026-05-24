/**
 * repo_personal_property — debtor belongings inventoried at recovery (Repo
 * Workflow Session 49). Most states require the repossessor to hold and
 * return personal property; released_at/released_to record the handoff back
 * to the debtor. Defined in packages/db/sql/0051_repo_workflow.sql.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { repoCases } from './repo-cases';
import { tenants } from './tenants';

export const repoPersonalProperty = pgTable(
  'repo_personal_property',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    repoCaseId: uuid('repo_case_id')
      .notNull()
      .references(() => repoCases.id, { onDelete: 'cascade' }),
    itemDescription: text('item_description').notNull(),
    photoUrl: text('photo_url'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedTo: text('released_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCaseIdx: index('repo_personal_property_tenant_case_idx')
      .on(t.tenantId, t.repoCaseId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type RepoPersonalProperty = typeof repoPersonalProperty.$inferSelect;
export type NewRepoPersonalProperty = typeof repoPersonalProperty.$inferInsert;
