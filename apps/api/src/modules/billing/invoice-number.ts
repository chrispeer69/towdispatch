/**
 * Per-tenant per-year invoice number sequence allocator.
 * Mirror of allocateJobNumber from JobsService — UPSERT + UPDATE … RETURNING
 * over (tenant_id, year_key) makes concurrent issues safe.
 *
 * Format: INV-YYYY-NNNN where N is zero-padded to 4 digits but allowed to
 * grow beyond 9999 within a year — the constraint in 0013_billing.sql allows
 * NNNN+ digits.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-aware-db.service.js';

export async function allocateInvoiceNumber(
  tx: Tx,
  tenantId: string,
  when: Date = new Date(),
): Promise<string> {
  const yearKey = String(when.getUTCFullYear());
  const result = await tx.execute<{ last_seq: string | number }>(
    sql`INSERT INTO invoice_number_sequences (tenant_id, year_key, last_seq, updated_at)
        VALUES (${tenantId}::uuid, ${yearKey}, 1, now())
        ON CONFLICT (tenant_id, year_key)
        DO UPDATE SET last_seq = invoice_number_sequences.last_seq + 1, updated_at = now()
        RETURNING last_seq`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('invoice_number_sequences upsert returned no row');
  const seq = typeof row.last_seq === 'string' ? Number(row.last_seq) : row.last_seq;
  return `INV-${yearKey}-${String(seq).padStart(4, '0')}`;
}

/**
 * Memo number: CM-YYYY-NNNN. We co-locate the sequence in the same table —
 * memo_numbers and invoice_numbers are visually distinct (CM vs INV) so a
 * shared sequence is fine and keeps the table count down. Use a separate
 * year_key suffix so the two sequences don't collide.
 */
export async function allocateMemoNumber(
  tx: Tx,
  tenantId: string,
  when: Date = new Date(),
): Promise<string> {
  const yearKey = `CM-${String(when.getUTCFullYear())}`;
  const result = await tx.execute<{ last_seq: string | number }>(
    sql`INSERT INTO invoice_number_sequences (tenant_id, year_key, last_seq, updated_at)
        VALUES (${tenantId}::uuid, ${yearKey}, 1, now())
        ON CONFLICT (tenant_id, year_key)
        DO UPDATE SET last_seq = invoice_number_sequences.last_seq + 1, updated_at = now()
        RETURNING last_seq`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('invoice_number_sequences upsert returned no row');
  const seq = typeof row.last_seq === 'string' ? Number(row.last_seq) : row.last_seq;
  return `CM-${String(when.getUTCFullYear())}-${String(seq).padStart(4, '0')}`;
}
