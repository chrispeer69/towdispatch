import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import { BundleService } from '../bundle.service.js';
import { dollarsToCents, normalizeString, parseTowbookTimestamp } from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

const STATUS_MAP: Record<string, string> = {
  open: 'issued',
  partial: 'partially_paid',
  paid: 'paid',
  void: 'void',
  issued: 'issued',
  draft: 'draft',
  overdue: 'overdue',
};

@Injectable()
export class InvoiceImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'invoice';
  protected readonly csvKey = 'invoices';

  // biome-ignore lint/complexity/noUselessConstructor: required for NestJS DI metadata
  constructor(bundle: BundleService) {
    super(bundle);
  }

  protected async importRow(
    ctx: ImportContext,
    get: (row: string[], field: string) => string | null,
    row: string[],
  ): Promise<ImportRowOutcome> {
    const externalId = normalizeString(get(row, 'external_id'));
    if (!externalId)
      return { action: 'error', externalId: null, errorMessage: 'missing external_id' };
    const invoiceNumber = normalizeString(get(row, 'invoice_number'));
    if (!invoiceNumber)
      return { action: 'error', externalId, errorMessage: 'missing invoice_number' };

    const jobExt = normalizeString(get(row, 'job_towbook_id'));
    const issuedAt = parseTowbookTimestamp(get(row, 'issued_date'));
    const dueAt = parseTowbookTimestamp(get(row, 'due_date'));
    const totalCents = dollarsToCents(get(row, 'total')) ?? 0;
    const balanceCents = dollarsToCents(get(row, 'balance')) ?? totalCents;
    const rawStatus = (normalizeString(get(row, 'status')) ?? 'open').toLowerCase();
    const status = STATUS_MAP[rawStatus] ?? 'issued';

    let jobId: string | null = null;
    let customerId: string | null = null;
    if (jobExt) {
      const r = await ctx.client.query<{ id: string; customer_id: string | null }>(
        `SELECT id, customer_id FROM jobs WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
        [ctx.tenantId, jobExt],
      );
      if (r.rowCount && r.rowCount > 0) {
        jobId = r.rows[0]?.id ?? null;
        customerId = r.rows[0]?.customer_id ?? null;
      } else {
        return { action: 'error', externalId, errorMessage: `unresolved job ${jobExt}` };
      }
    }

    const byExternal = await ctx.client.query<{ id: string }>(
      `SELECT id FROM invoices WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, externalId],
    );
    if (byExternal.rowCount && byExternal.rowCount > 0) {
      const id = byExternal.rows[0]?.id ?? null;
      if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
      await ctx.client.query(
        `UPDATE invoices SET
            status = $2,
            total_cents = $3,
            balance_cents = $4,
            issued_at = COALESCE($5, issued_at),
            due_at = COALESCE($6, due_at),
            updated_at = now()
         WHERE id=$1`,
        [id, status, totalCents, balanceCents, issuedAt, dueAt],
      );
      return { action: 'update', externalId, towcommandId: id };
    }

    const id = uuidv7();
    await ctx.client.query(
      `INSERT INTO invoices (
          id, tenant_id, type, invoice_number, status,
          job_id, customer_id,
          subtotal_cents, tax_total_cents, total_cents, balance_cents,
          issued_at, due_at, created_at, updated_at,
          external_source, external_id
       ) VALUES (
          $1, $2, 'service', $3, $4,
          $5, $6,
          $7, 0, $7, $8,
          COALESCE($9, now()), $10, COALESCE($9, now()), now(),
          'towbook', $11
       )`,
      [
        id,
        ctx.tenantId,
        invoiceNumber,
        status,
        jobId,
        customerId,
        totalCents,
        balanceCents,
        issuedAt,
        dueAt,
        externalId,
      ],
    );
    return { action: 'create', externalId, towcommandId: id };
  }
}
