/**
 * StorageProvider — the cross-app interface for binary file storage.
 *
 * Mirrors the MapsProvider pattern from Session 5: the contract lives here
 * in shared, with concrete implementations registered in apps/api. The web
 * app never talks to storage directly — uploads go through the API, which
 * uses the provider to persist the bytes.
 *
 * Object keys MUST start with `tenants/{tenantId}/` so cross-tenant access
 * via path traversal is structurally impossible. The local-disk
 * implementation rejects any key that doesn't match this prefix.
 */
import { z } from 'zod';

export const storedObjectSchema = z.object({
  key: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string(),
  fileName: z.string(),
});
export type StoredObject = z.infer<typeof storedObjectSchema>;

export interface StoragePutInput {
  tenantId: string;
  ownerType: string;
  ownerId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export interface StorageProvider {
  readonly id: string;
  /** Persist bytes; returns the canonical object key (always tenant-scoped). */
  put(input: StoragePutInput): Promise<StoredObject>;
  /** Read bytes by key. Throws if the key doesn't belong to tenantId. */
  get(tenantId: string, key: string): Promise<Buffer>;
  /** Delete an object. Soft-delete is at the documents-row level; this is hard delete. */
  delete(tenantId: string, key: string): Promise<void>;
  /**
   * Resolve a key to a URL the web app can render or stream from. The local
   * implementation produces a relative API URL (/files/{key}); S3 will
   * produce a presigned URL. Either way the URL embeds tenant verification.
   */
  toUrl(tenantId: string, key: string): string;
}
