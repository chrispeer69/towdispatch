/**
 * chat_threads / chat_messages — driver↔dispatcher chat (Session 6.2).
 *
 * One thread per job. Drivers and dispatchers exchange text/voice/photo/video
 * messages on the same job_id. Attachments are S3-style presigned URLs —
 * bytes never travel through the API.
 *
 * Pagination on chat_messages uses (created_at DESC, id DESC) as the cursor
 * tiebreaker; the supporting index is created in the SQL pass.
 *
 * Idempotency: chat_messages.client_message_id is a per-(tenant, thread)
 * dedupe key. The partial unique index lives in the raw-SQL migration (it
 * applies only when client_message_id IS NOT NULL).
 */
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const chatAuthorRoleValues = ['driver', 'dispatcher', 'admin', 'manager'] as const;
export type ChatAuthorRole = (typeof chatAuthorRoleValues)[number];

export const chatAttachmentTypeValues = ['none', 'voice_memo', 'photo', 'video'] as const;
export type ChatAttachmentType = (typeof chatAttachmentTypeValues)[number];

export const chatThreads = pgTable(
  'chat_threads',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantJobUnique: uniqueIndex('chat_threads_tenant_job_unique').on(t.tenantId, t.jobId),
  }),
);

export type ChatThread = typeof chatThreads.$inferSelect;
export type NewChatThread = typeof chatThreads.$inferInsert;

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    authorRole: text('author_role', { enum: chatAuthorRoleValues }).notNull(),

    /** Body is null for pure-attachment messages (voice memos with no text). */
    body: text('body'),
    /** Storage URL / object key. Null when attachment_type='none'. */
    attachmentUrl: text('attachment_url'),
    attachmentType: text('attachment_type', { enum: chatAttachmentTypeValues })
      .notNull()
      .default('none'),

    /**
     * Per-(tenant, thread) idempotency key. iOS supplies its outbox row id
     * here; retries within 24h return the existing row instead of inserting.
     */
    clientMessageId: text('client_message_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => ({
    tenantThreadCreatedIdx: index('chat_messages_tenant_thread_created_idx').on(
      t.tenantId,
      t.threadId,
      t.createdAt,
      t.id,
    ),
  }),
);

export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
