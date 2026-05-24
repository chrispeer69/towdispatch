/**
 * voice_command_log — one row per voice command processed by the
 * hands-free driver workflow (Voice-Controlled Driver Workflows,
 * Session 45).
 *
 * An AUDIT table, not a command queue: it records what the driver said,
 * the intent we recognized, the parser's confidence, and what action (if
 * any) we took against the EXISTING job-status transitions. The two
 * confirmation columns implement the spoken-confirmation gate for
 * destructive intents without any server-side session state — a pending
 * row is `confirmation_required = true AND confirmed_at IS NULL AND
 * succeeded = false`, found by (tenant_id, driver_id) within a short TTL.
 *
 * Defined in packages/db/sql/0046_voice_commands.sql.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

// Parser-emitted + internal-confirmation values stored in the log. The
// PUBLIC intent enum (the 12 driver intents) lives in @ustowdispatch/shared;
// 'clarify' / 'confirm_yes' / 'confirm_no' are recognized-intent values the
// service writes, not parser outputs the client asks for.
export const voiceRecognizedIntentValues = [
  'accept_job',
  'decline_job',
  'en_route',
  'arrive_on_scene',
  'vehicle_loaded',
  'en_route_drop',
  'arrive_drop',
  'clear_job',
  'request_help',
  'repeat_address',
  'eta_update',
  'mark_breakdown',
  'clarify',
  'confirm_yes',
  'confirm_no',
] as const;
export type VoiceRecognizedIntent = (typeof voiceRecognizedIntentValues)[number];

export const voicePlatformValues = ['ios_carplay', 'android_auto', 'web', 'other'] as const;
export type VoicePlatform = (typeof voicePlatformValues)[number];

export const voiceLocaleValues = ['en', 'es'] as const;
export type VoiceLocale = (typeof voiceLocaleValues)[number];

export const voiceCommandLog = pgTable(
  'voice_command_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    commandText: text('command_text').notNull(),
    recognizedIntent: text('recognized_intent', { enum: voiceRecognizedIntentValues }).notNull(),
    intentConfidence: doublePrecision('intent_confidence').notNull().default(0),
    actionTaken: text('action_taken'),
    succeeded: boolean('succeeded').notNull().default(false),
    error: text('error'),
    confirmationRequired: boolean('confirmation_required').notNull().default(false),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    platform: text('platform', { enum: voicePlatformValues }).notNull().default('other'),
    locale: text('locale', { enum: voiceLocaleValues }).notNull().default('en'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantDriverIdx: index('voice_command_log_tenant_driver_idx')
      .on(t.tenantId, t.driverId, t.occurredAt.desc())
      .where(sql`deleted_at IS NULL`),
    pendingConfirmIdx: index('voice_command_log_pending_confirm_idx')
      .on(t.tenantId, t.driverId, t.occurredAt.desc())
      .where(
        sql`confirmation_required = true AND confirmed_at IS NULL AND succeeded = false AND deleted_at IS NULL`,
      ),
    jobIdx: index('voice_command_log_job_idx')
      .on(t.jobId)
      .where(sql`job_id IS NOT NULL AND deleted_at IS NULL`),
  }),
);

export type VoiceCommandLog = typeof voiceCommandLog.$inferSelect;
export type NewVoiceCommandLog = typeof voiceCommandLog.$inferInsert;
