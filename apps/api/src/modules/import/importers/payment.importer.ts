import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import { BundleService } from '../bundle.service.js';
import {
  dollarsToCents,
  mapValue,
  normalizeString,
  parseTowbookTimestamp,
} from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

@Injectable()
export class PaymentImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'payment';
  protected readonly csvKey = 'payments';

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

    const invoiceExt = normalizeString(get(row, 'invoice_towbook_id'));
    if (!invoiceExt)
      return { action: 'error', externalId, errorMessage: 'missing invoice reference' };
    const receivedAt = parseTowbookTimestamp(get(row, 'received_date'));
    const amountCents = dollarsToCents(get(row, 'amount'));
    if (amountCents === null || amountCents <= 0) {
      return { action: 'error', externalId, errorMessage: 'invalid amount' };
    }
    const method = mapValue(ctx.mapping.value_maps, 'payment_method', get(row, 'method')) ?? 'cash';
    const reference = normalizeString(get(row, 'reference'));

    const invR = await ctx.client.query<{ id: string }>(
      `SELECT id FROM invoices WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, invoiceExt],
    );
    if (invR.rowCount === 0) {
      return { action: 'error', externalId, errorMessage: `unresolved invoice ${invoiceExt}` };
    }
    const invoiceId = invR.rows[0]?.id;

    const byExternal = await ctx.client.query<{ id: string }>(
      `SELECT id FROM payments WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, externalId],
    );
    if (byExternal.rowCount && byExternal.rowCount > 0) {
      return { action: 'skip_dedup', externalId, towcommandId: byExternal.rows[0]?.id ?? null };
    }

    const id = uuidv7();
    await ctx.client.query(
      `INSERT INTO payments (
          id, tenant_id, invoice_id, method, amount_cents,
          status, received_at, reference, created_at,
          external_source, external_id
       ) VALUES (
          $1, $2, $3, $4, $5,
          'received', COALESCE($6, now()), $7, COALESCE($6, now()),
          'towbook', $8
       )`,
      [id, ctx.tenantId, invoiceId, method, amountCents, receivedAt, reference, externalId],
    );

    // Apply payment to invoice balance (best-effort; Session 10/11 has its
    // own canonical apply-payment service, but for imported historical data
    // we set the balance directly to keep the books in sync).
    await ctx.client.query(
      `UPDATE invoices
       SET balance_cents = GREATEST(balance_cents - $2, 0),
           status = CASE
             WHEN balance_cents - $2 <= 0 THEN 'paid'
             WHEN balance_cents - $2 < total_cents THEN 'partially_paid'
             ELSE status
           END,
           updated_at = now()
       WHERE id = $1`,
      [invoiceId, amountCents],
    );

    return { action: 'create', externalId, towcommandId: id };
  }
}
