import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@towcommand/db';
import type { StorageProvider } from '@towcommand/shared';
import { STORAGE_PROVIDER } from '../../storage/storage.module.js';
import { BundleService } from '../bundle.service.js';
import { normalizeString } from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

/**
 * Attachments are referenced by Towbook call ID via the attachments
 * manifest CSV. Each row points at a media/<filename> entry in the ZIP.
 * We resolve the binary, push it through the StorageProvider under the
 * tenant-isolated `tenants/{tenantId}/job/{jobId}/...` prefix, then write
 * a `documents` row with ownerType='job' so the existing job-attachment
 * relationship picks it up.
 *
 * If the manifest references a Towbook job that didn't import (typically
 * because the call CSV row failed validation), we log the orphan to the
 * errors report rather than dropping the file on the floor.
 */
@Injectable()
export class AttachmentImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'attachment';
  protected readonly csvKey = 'attachments_manifest';

  constructor(
    bundle: BundleService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {
    super(bundle);
  }

  /** Override run() so we can also receive the bundle's attachment map. */
  override async run(ctx: ImportContext, b: import('./base.importer.js').ImporterBundle) {
    this._attachmentBytes = b.attachments;
    return super.run(ctx, b);
  }

  private _attachmentBytes: Map<string, Buffer> = new Map();

  protected async importRow(
    ctx: ImportContext,
    get: (row: string[], field: string) => string | null,
    row: string[],
  ): Promise<ImportRowOutcome> {
    const jobExt = normalizeString(get(row, 'towbook_id'));
    const filename = normalizeString(get(row, 'filename'));
    const kind = normalizeString(get(row, 'type')) ?? 'photo';

    if (!jobExt || !filename) {
      return { action: 'error', externalId: filename, errorMessage: 'missing job or filename' };
    }

    const jobR = await ctx.client.query<{ id: string }>(
      `SELECT id FROM jobs WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, jobExt],
    );
    if (jobR.rowCount === 0) {
      return {
        action: 'error',
        externalId: filename,
        errorMessage: `attachment references unimported job ${jobExt}`,
      };
    }
    const jobId = jobR.rows[0]?.id;

    const bytes = this._attachmentBytes.get(filename.toLowerCase());
    if (!bytes) {
      return {
        action: 'error',
        externalId: filename,
        errorMessage: `file ${filename} not present in bundle`,
      };
    }

    // Dedup: have we already imported this file for this job?
    const existing = await ctx.client.query<{ id: string }>(
      `SELECT id FROM documents
       WHERE tenant_id=$1 AND owner_type='job' AND owner_id=$2 AND file_name=$3
       LIMIT 1`,
      [ctx.tenantId, jobId, filename],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return { action: 'skip_dedup', externalId: filename, towcommandId: existing.rows[0]?.id };
    }

    if (ctx.mode === 'dry_run') {
      // Skip the actual storage write in dry-run, but record the intent.
      return { action: 'create', externalId: filename, towcommandId: null };
    }

    const stored = await this.storage.put({
      tenantId: ctx.tenantId,
      ownerType: 'job',
      ownerId: jobId,
      fileName: filename,
      mimeType: guessMime(filename),
      bytes,
    });

    const id = uuidv7();
    await ctx.client.query(
      `INSERT INTO documents (
          id, tenant_id, owner_type, owner_id, doc_type,
          file_url, file_name, mime_type, size_bytes,
          uploaded_at, created_at
       ) VALUES ($1, $2, 'job', $3, $4, $5, $6, $7, $8, now(), now())`,
      [
        id,
        ctx.tenantId,
        jobId,
        kind === 'signature' ? 'photo' : 'photo',
        stored.key,
        filename,
        guessMime(filename),
        bytes.byteLength,
      ],
    );
    return { action: 'create', externalId: filename, towcommandId: id };
  }
}

const guessMime = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
};
