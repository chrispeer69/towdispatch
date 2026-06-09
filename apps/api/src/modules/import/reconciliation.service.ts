import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * ReconciliationService — diffs a Towbook export bundle against what's
 * currently in Tow Dispatch for a given tenant. Returns three buckets:
 *
 *   missing  — rows in the bundle, NOT in Tow Dispatch
 *   orphaned — rows in Tow Dispatch with external_source='towbook' that are
 *              NOT in the current bundle (deleted-in-Towbook candidates)
 *   drift    — rows present in both with field mismatches (we name the
 *              columns that differ)
 *
 * Run on a clean migration before cancelling the Towbook subscription.
 * Founder cancels when missing == 0 and drift == 0.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { APP_POOL } from '../../database/database.tokens.js';
import { BundleService } from './bundle.service.js';
import { normalizeEmail, normalizePhone, normalizeString } from './normalizers.js';
import type { TowbookMapping } from './types.js';

export interface ReconciliationDiff {
  recordType: 'customer' | 'vehicle' | 'job' | 'invoice' | 'payment' | 'driver' | 'truck';
  missing: { externalId: string; identifier: string }[];
  orphaned: { externalId: string; towdispatchId: string; identifier: string }[];
  drift: {
    externalId: string;
    towdispatchId: string;
    fields: { field: string; bundle: string | null; db: string | null }[];
  }[];
}

/**
 * A drift-field definition. When the DB column name and the bundle's
 * canonical mapping name differ (e.g. db `phone` vs bundle `phone_primary`)
 * the two must be specified separately. When equal, pass a string.
 */
type DriftField = string | { db: string; bundle: string };

const driftDb = (f: DriftField) => (typeof f === 'string' ? f : f.db);
const driftBundle = (f: DriftField) => (typeof f === 'string' ? f : f.bundle);

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(APP_POOL) private readonly pool: Pool,
    private readonly bundle: BundleService,
  ) {}

  async reconcile(input: {
    tenantId: string;
    userId: string;
    bundle: Buffer;
  }): Promise<ReconciliationDiff[]> {
    const mapping = await this.loadMapping();
    const b = await this.bundle.openZip(input.bundle);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [input.tenantId]);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [input.userId]);

      const out: ReconciliationDiff[] = [];

      const customers = await this.reconcileTable({
        client,
        recordType: 'customer',
        table: 'customers',
        csvKey: 'customers',
        identifier: 'name',
        driftFields: ['name', { db: 'phone', bundle: 'phone_primary' }, 'email'],
        bundle: b,
        mapping,
      });
      out.push(customers);

      const vehicles = await this.reconcileTable({
        client,
        recordType: 'vehicle',
        table: 'vehicles',
        csvKey: 'vehicles',
        identifier: 'vin',
        driftFields: ['vin', 'plate', 'plate_state'],
        bundle: b,
        mapping,
      });
      out.push(vehicles);

      const jobs = await this.reconcileTable({
        client,
        recordType: 'job',
        table: 'jobs',
        csvKey: 'calls',
        identifier: 'pickup_address',
        driftFields: ['service_type', 'status'],
        bundle: b,
        mapping,
      });
      out.push(jobs);

      const drivers = await this.reconcileTable({
        client,
        recordType: 'driver',
        table: 'drivers',
        csvKey: 'drivers',
        identifier: 'name',
        driftFields: ['phone', 'email'],
        bundle: b,
        mapping,
      });
      out.push(drivers);

      const trucks = await this.reconcileTable({
        client,
        recordType: 'truck',
        table: 'trucks',
        csvKey: 'trucks',
        identifier: 'unit_number',
        driftFields: ['vin', 'unit_number'],
        bundle: b,
        mapping,
      });
      out.push(trucks);

      const invoices = await this.reconcileTable({
        client,
        recordType: 'invoice',
        table: 'invoices',
        csvKey: 'invoices',
        identifier: 'invoice_number',
        driftFields: ['invoice_number', 'status'],
        bundle: b,
        mapping,
      });
      out.push(invoices);

      const payments = await this.reconcileTable({
        client,
        recordType: 'payment',
        table: 'payments',
        csvKey: 'payments',
        identifier: 'reference',
        driftFields: ['amount_cents'],
        bundle: b,
        mapping,
      });
      out.push(payments);

      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async reconcileTable(opts: {
    client: import('pg').PoolClient;
    recordType: ReconciliationDiff['recordType'];
    table: string;
    csvKey: string;
    identifier: string;
    driftFields: DriftField[];
    bundle: {
      csv: Map<string, import('./types.js').ParsedCsvFile>;
      attachments: Map<string, Buffer>;
    };
    mapping: TowbookMapping;
  }): Promise<ReconciliationDiff> {
    const file = opts.bundle.csv.get(opts.csvKey);
    const bundleByExternal = new Map<string, string[]>();
    if (file) {
      const get = this.bundle.buildRowGetter(opts.mapping, opts.csvKey, file.headerMap);
      for (const row of file.rows) {
        const ext = normalizeString(get(row, 'external_id'));
        if (ext) bundleByExternal.set(ext, row);
      }
    }

    // Tenant scoping is handled by RLS via app.current_tenant_id GUC set in
    // the caller (reconcile()). Do NOT add WHERE tenant_id=… here — RLS
    // already filters and the parameter list above is empty.
    const dbColumns = opts.driftFields.map(driftDb);
    const dbRows = await opts.client.query<{
      id: string;
      external_id: string;
      [key: string]: string;
    }>(
      `SELECT id, external_id, ${dbColumns.join(', ')}
       FROM ${opts.table}
       WHERE external_source='towbook' AND external_id IS NOT NULL`,
      [],
    );

    const dbByExternal = new Map<string, (typeof dbRows.rows)[number]>();
    for (const r of dbRows.rows) dbByExternal.set(r.external_id, r);

    const missing: ReconciliationDiff['missing'] = [];
    const drift: ReconciliationDiff['drift'] = [];

    for (const [ext, row] of bundleByExternal.entries()) {
      if (!dbByExternal.has(ext)) {
        const get = file
          ? this.bundle.buildRowGetter(opts.mapping, opts.csvKey, file.headerMap)
          : null;
        const ident = get ? (get(row, opts.identifier) ?? ext) : ext;
        missing.push({ externalId: ext, identifier: ident });
      } else {
        const dbRow = dbByExternal.get(ext)!;
        const fieldDiffs: ReconciliationDiff['drift'][number]['fields'] = [];
        const get = file
          ? this.bundle.buildRowGetter(opts.mapping, opts.csvKey, file.headerMap)
          : null;
        if (get) {
          for (const f of opts.driftFields) {
            const dbField = driftDb(f);
            const bundleField = driftBundle(f);
            const bundleVal = normalizeForCompare(dbField, get(row, bundleField));
            const dbVal = normalizeForCompare(dbField, dbRow[dbField] ?? null);
            if (bundleVal !== dbVal) {
              fieldDiffs.push({ field: dbField, bundle: bundleVal, db: dbVal });
            }
          }
        }
        if (fieldDiffs.length > 0) {
          drift.push({ externalId: ext, towdispatchId: dbRow.id, fields: fieldDiffs });
        }
      }
    }

    const orphaned: ReconciliationDiff['orphaned'] = [];
    for (const [ext, dbRow] of dbByExternal.entries()) {
      if (!bundleByExternal.has(ext)) {
        orphaned.push({
          externalId: ext,
          towdispatchId: dbRow.id,
          identifier: dbRow[opts.identifier] ?? ext,
        });
      }
    }

    return { recordType: opts.recordType, missing, orphaned, drift };
  }

  private mappingCache: TowbookMapping | null = null;
  private async loadMapping(): Promise<TowbookMapping> {
    if (this.mappingCache) return this.mappingCache;
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, 'column-mappings', 'towbook.json');
    const json = JSON.parse(await readFile(path, 'utf8')) as TowbookMapping;
    this.mappingCache = json;
    return json;
  }
}

const normalizeForCompare = (field: string, value: string | null): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (field === 'phone') return normalizePhone(value);
  if (field === 'email') return normalizeEmail(value);
  return String(value).trim().toLowerCase();
};
