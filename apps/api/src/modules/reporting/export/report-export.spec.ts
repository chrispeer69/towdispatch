import type { ReportId } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import type { ReportDetail } from '../reporting.types.js';
import { ReportExportService } from './report-export.service.js';

function fakeDetail(reportId: ReportId): ReportDetail {
  return {
    reportId,
    generatedAt: new Date('2026-05-11T00:00:00Z'),
    kpis: [
      { label: 'Jobs', value: 42, tone: 'neutral' },
      { label: 'GOA', value: '3.2%', tone: 'warn' },
    ],
    timeSeries: [{ bucket: '2026-05-10', value: 10 }],
    breakdown: [{ key: 'a', label: 'A', value: 1 }],
    rows: [
      { driver: 'Mike', jobs: 12, revenueCents: 120000 },
      { driver: 'Jane', jobs: 9, revenueCents: 90000 },
    ],
    totalRows: 2,
    nextCursor: null,
    notes: ['Note one'],
  };
}

// We exercise the pure transform on a service constructed with a stub
// StorageProvider — we never reach persist().
const stubStorage = {
  id: 'stub',
  put: () => Promise.reject(new Error('not used')),
  get: () => Promise.reject(new Error('not used')),
  delete: () => Promise.reject(new Error('not used')),
  toUrl: () => '/files/stub',
};

const service = new ReportExportService(stubStorage as never);

describe('ReportExportService.toCsv', () => {
  it('emits a header block, KPI block, and data rows', () => {
    const csv = service.toCsv(fakeDetail('driver-performance'));
    expect(csv).toContain('Report,driver-performance');
    expect(csv).toContain('Jobs,42');
    expect(csv).toContain('driver,jobs,revenueCents');
    expect(csv).toContain('Mike,12,120000');
    expect(csv).toContain('Jane,9,90000');
  });

  it('handles empty rows gracefully', () => {
    const detail = { ...fakeDetail('tax'), rows: [], totalRows: 0 };
    const csv = service.toCsv(detail);
    expect(csv).toContain('Report,tax');
  });
});

describe('ReportExportService.toPdf', () => {
  it('produces a non-empty PDF buffer for a normal detail', async () => {
    const buf = await service.toPdf('revenue', fakeDetail('revenue'), 'May revenue');
    expect(buf.byteLength).toBeGreaterThan(500);
    // PDF magic number: %PDF
    expect(buf.slice(0, 4).toString('utf8')).toBe('%PDF');
  });
});
