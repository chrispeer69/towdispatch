/**
 * Export service tests — verify CSV and PDF generation produce non-empty
 * bytes and the storage put is shaped correctly.
 */
import { describe, expect, it } from 'vitest';
import { ReportExportService } from './export.service.js';

class StubStorage {
  id = 'stub';
  puts: unknown[] = [];
  async put(input: any): Promise<any> {
    this.puts.push(input);
    return { key: `tenants/${input.tenantId}/report_export/${input.ownerId}/abc-${input.fileName}`, sizeBytes: input.bytes.byteLength, mimeType: input.mimeType, fileName: input.fileName };
  }
  async get(): Promise<Buffer> {
    return Buffer.alloc(0);
  }
  async delete(): Promise<void> {
    /* noop */
  }
  toUrl(_tenantId: string, key: string): string {
    return `/files/${key}`;
  }
}

describe('ReportExportService', () => {
  it('emits CSV bytes with header and rows', async () => {
    const storage = new StubStorage();
    const svc = new ReportExportService(storage as any);
    const result = await svc.export({
      tenantId: '00000000-0000-0000-0000-000000000001',
      ownerUserId: '00000000-0000-0000-0000-000000000002',
      reportId: 'dispatch',
      reportTitle: 'Dispatch',
      columns: ['A', 'B'],
      rows: [
        [1, 'two'],
        [3, 'four,with comma'],
      ],
      kpis: [{ label: 'Jobs', value: '12' }],
      format: 'csv',
    });
    expect(result.format).toBe('csv');
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.filename.endsWith('.csv')).toBe(true);
    const put = storage.puts[0] as { bytes: Buffer };
    expect(put.bytes.toString('utf8')).toContain('A,B');
    expect(put.bytes.toString('utf8')).toContain('"four,with comma"');
  });

  it('emits PDF bytes starting with %PDF', async () => {
    const storage = new StubStorage();
    const svc = new ReportExportService(storage as any);
    const result = await svc.export({
      tenantId: '00000000-0000-0000-0000-000000000001',
      ownerUserId: '00000000-0000-0000-0000-000000000002',
      reportId: 'revenue',
      reportTitle: 'Revenue',
      columns: ['Label', 'Revenue'],
      rows: [['Tow', '12345']],
      kpis: [{ label: 'Revenue', value: '$1,234' }],
      format: 'pdf',
    });
    expect(result.format).toBe('pdf');
    expect(result.bytes).toBeGreaterThan(0);
    const put = storage.puts[0] as { bytes: Buffer };
    expect(put.bytes.slice(0, 4).toString('utf8')).toBe('%PDF');
  });
});
