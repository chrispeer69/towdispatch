/**
 * documents — polymorphic file attachments.
 *
 * One row per uploaded file. The owner pair (owner_type, owner_id) points at
 * trucks / drivers / vehicles / customers / accounts / jobs. We use a
 * polymorphic pair instead of separate tables because all owners share the
 * same lifecycle (upload, expire, soft-delete) and the same per-tenant
 * storage layout, and reporting wants one place to scan for "everything
 * expiring in the next 30 days."
 *
 * Storage paths always include tenant_id — see StorageProvider.objectKey().
 * The file_url stored here is the canonical key the StorageProvider can
 * resolve back to bytes; for the local-disk implementation this is the
 * relative path under apps/api/storage/. For S3 it's the object key under
 * the configured bucket.
 *
 * Soft-deleted, audited, FORCE RLS, owner-type CHECKed in SQL.
 */
import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const documentOwnerTypeValues = [
  'truck',
  'driver',
  'vehicle',
  'customer',
  'account',
  'job',
] as const;
export type DocumentOwnerType = (typeof documentOwnerTypeValues)[number];

/**
 * Allow-listed document kinds. Adding a value is a migration so the
 * expirations dashboard knows how to label and sort it.
 */
export const documentTypeValues = [
  'registration',
  'insurance',
  'inspection',
  'cdl',
  'license',
  'medical_card',
  'drug_test',
  'road_test',
  'training_cert',
  'tax_exempt',
  'coi',
  'photo',
  'invoice',
  'other',
] as const;
export type DocumentType = (typeof documentTypeValues)[number];

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    ownerType: text('owner_type', { enum: documentOwnerTypeValues }).notNull(),
    ownerId: uuid('owner_id').notNull(),

    docType: text('doc_type', { enum: documentTypeValues }).notNull(),

    /**
     * StorageProvider key (relative path / object key). Resolution is the
     * provider's job — never assume http:// here. The "url" naming matches
     * the spec; treat it as opaque.
     */
    fileUrl: text('file_url').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),

    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    /** Per-doc-type expiration. NULL = no expiry tracking for this doc. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantOwnerIdx: index('documents_tenant_owner_idx').on(t.tenantId, t.ownerType, t.ownerId),
    tenantTypeIdx: index('documents_tenant_doc_type_idx').on(t.tenantId, t.docType),
    tenantExpiresIdx: index('documents_tenant_expires_idx').on(t.tenantId, t.expiresAt),
  }),
);

export type DocumentRecord = typeof documents.$inferSelect;
export type NewDocumentRecord = typeof documents.$inferInsert;
