/**
 * ev_oem_procedures — per make / model / model-year-range OEM towing guidance
 * (EV Recovery, Session 48).
 *
 * GLOBAL reference data: NOT tenant-scoped, no RLS. Same posture as
 * lien_state_rules — OEM procedure is identical for every operator, so
 * app_user reads it via the default-privilege SELECT grant. Seeded for the
 * top 15 EVs in the migration. The tow-mode / HV-disconnect steps are
 * best-effort and carry last_verified_at; verify against the current OEM
 * service manual before field use (see SESSION_48_DECISIONS.md).
 *
 * Surrogate uuid PK + unique (lower(make), lower(model), year-from): a make
 * has many models and `model` is nullable, so the launch's "make PK" cannot
 * hold — documented in the decisions log.
 *
 * Defined in packages/db/sql/0042_ev_recovery.sql.
 */
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const evOemProcedures = pgTable(
  'ev_oem_procedures',
  {
    id: uuid('id').primaryKey(),
    make: text('make').notNull(),
    model: text('model'),
    modelYearFrom: integer('model_year_from'),
    modelYearTo: integer('model_year_to'),
    towModeSteps: text('tow_mode_steps').notNull(),
    hvDisconnectSteps: text('hv_disconnect_steps').notNull(),
    jackingPointsUrl: text('jacking_points_url'),
    officialDocUrl: text('official_doc_url'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The real DB index is on lower(make) (created in the SQL migration); this
  // drizzle metadata index is informational only — raw SQL owns the schema.
  (t) => ({
    makeIdx: index('ev_oem_procedures_make_idx').on(t.make),
  }),
);

export type EvOemProcedureRow = typeof evOemProcedures.$inferSelect;
export type NewEvOemProcedureRow = typeof evOemProcedures.$inferInsert;
