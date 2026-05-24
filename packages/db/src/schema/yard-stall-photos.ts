/**
 * yard_stall_photos — photos pinned to a stall (Yard Management,
 * Session 54). Append-only evidence; a hard delete is the intentional
 * "remove photo" action. Defined in packages/db/sql/0051_yard_management.sql.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { yardStalls } from './yard-stalls';

export const yardStallPhotoTypeValues = [
  'overview',
  'vehicle_in',
  'vehicle_out',
  'condition',
] as const;
export type YardStallPhotoType = (typeof yardStallPhotoTypeValues)[number];

export const yardStallPhotos = pgTable(
  'yard_stall_photos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    stallId: uuid('stall_id')
      .notNull()
      .references(() => yardStalls.id, { onDelete: 'cascade' }),
    photoUrl: text('photo_url').notNull(),
    photoType: text('photo_type', { enum: yardStallPhotoTypeValues }).notNull().default('overview'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    capturedByUserId: uuid('captured_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantStallIdx: index('yard_stall_photos_tenant_stall_idx').on(t.tenantId, t.stallId),
  }),
);

export type YardStallPhoto = typeof yardStallPhotos.$inferSelect;
export type NewYardStallPhoto = typeof yardStallPhotos.$inferInsert;
