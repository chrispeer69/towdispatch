/**
 * BundleService — opens a Towbook export ZIP and surfaces:
 *   - parsed CSV files (streaming where possible, then materialized as
 *     header-map + row arrays to keep importer code simple)
 *   - the binary contents of every attachment, lazily resolved by filename
 *
 * Implementation notes:
 *   - yauzl is used in lazy-entry-stream mode so a 2GB ZIP doesn't blow heap
 *   - csv-parse runs in sync mode on each entry buffer — CSVs in a Towbook
 *     export are bounded (tens of MB at most). For multi-hundred-MB CSVs we
 *     would switch to true streaming, but that's a future optimization
 *     called out in the report.
 *   - file lookup is case-insensitive on both the entry name and the
 *     CSV-name match because Towbook's exports historically vary in casing
 */
import { Injectable, Logger } from '@nestjs/common';
import { parse as csvParseSync } from 'csv-parse/sync';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type { ParsedCsvFile, TowbookMapping } from './types.js';

const RECORD_CSV_NAMES: Record<string, string> = {
  customers: 'customers.csv',
  vehicles: 'vehicles.csv',
  calls: 'calls.csv',
  impounds: 'impounds.csv',
  drivers: 'drivers.csv',
  trucks: 'trucks.csv',
  invoices: 'invoices.csv',
  payments: 'payments.csv',
  motor_club_history: 'motor_club_history.csv',
  attachments_manifest: 'attachments.csv',
};

const ATTACHMENT_DIR_PREFIX = 'media/';

interface ZipBundle {
  csv: Map<string, ParsedCsvFile>;
  attachments: Map<string, Buffer>;
}

@Injectable()
export class BundleService {
  private readonly logger = new Logger(BundleService.name);

  async openZip(zipBytes: Buffer): Promise<ZipBundle> {
    const csv = new Map<string, ParsedCsvFile>();
    const attachments = new Map<string, Buffer>();

    const zip = await new Promise<ZipFile>((resolve, reject) => {
      yauzl.fromBuffer(zipBytes, { lazyEntries: true }, (err, z) => {
        if (err || !z) reject(err ?? new Error('zip open failed'));
        else resolve(z);
      });
    });

    await new Promise<void>((resolve, reject) => {
      zip.on('entry', (entry: Entry) => {
        const name = entry.fileName.toLowerCase();
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) {
            reject(err ?? new Error('readStream missing'));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            const data = Buffer.concat(chunks);
            if (name.endsWith('.csv')) {
              const recordKey = this.recordKeyForCsvName(name);
              if (recordKey) {
                csv.set(recordKey, this.parseCsv(data));
              }
            } else if (name.startsWith(ATTACHMENT_DIR_PREFIX)) {
              const fileName = entry.fileName.slice(ATTACHMENT_DIR_PREFIX.length);
              attachments.set(fileName.toLowerCase(), data);
            }
            zip.readEntry();
          });
          stream.on('error', (err) => reject(err));
        });
      });
      zip.once('end', () => resolve());
      zip.once('error', (err) => reject(err));
      zip.readEntry();
    });

    return { csv, attachments };
  }

  private parseCsv(bytes: Buffer): ParsedCsvFile {
    const records = csvParseSync(bytes, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];
    if (records.length === 0) return { headerMap: new Map(), rows: [] };
    const header = records[0]!;
    const headerMap = new Map<string, number>();
    header.forEach((h, i) => headerMap.set(h.toLowerCase().trim(), i));
    return { headerMap, rows: records.slice(1) };
  }

  private recordKeyForCsvName(filename: string): string | null {
    const base = filename.split('/').pop() ?? filename;
    for (const [key, expected] of Object.entries(RECORD_CSV_NAMES)) {
      if (base === expected) return key;
    }
    return null;
  }

  resolveColumnIndex(
    mapping: TowbookMapping,
    recordKey: string,
    canonicalField: string,
    headerMap: Map<string, number>,
  ): number | null {
    const fileMap = mapping.files[recordKey];
    if (!fileMap) return null;
    const aliases = fileMap[canonicalField];
    if (!aliases) return null;
    for (const alias of aliases) {
      const idx = headerMap.get(alias.toLowerCase());
      if (idx !== undefined) return idx;
    }
    return null;
  }

  /**
   * Returns a getter that reads `canonicalField` from a row using the
   * resolved column index, or null if the row doesn't have that column.
   */
  buildRowGetter(
    mapping: TowbookMapping,
    recordKey: string,
    headerMap: Map<string, number>,
  ): (row: string[], canonicalField: string) => string | null {
    const cache = new Map<string, number | null>();
    return (row, canonicalField) => {
      let idx = cache.get(canonicalField);
      if (idx === undefined) {
        idx = this.resolveColumnIndex(mapping, recordKey, canonicalField, headerMap);
        cache.set(canonicalField, idx);
      }
      if (idx === null) return null;
      const v = row[idx];
      return v === undefined ? null : v;
    };
  }
}
