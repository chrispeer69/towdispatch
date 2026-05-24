import type {
  CompareResult,
  DamageAnalysisDto,
  DamageComparisonDto,
  DamageFindingDto,
} from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { DamageReportPdfService } from './damage-report-pdf.service.js';

const svc = new DamageReportPdfService();

const analysis: DamageAnalysisDto = {
  id: '00000000-0000-7000-8000-000000000001',
  tenantId: '00000000-0000-7000-8000-0000000000aa',
  jobId: '00000000-0000-7000-8000-0000000000bb',
  phase: 'post_tow',
  photoKeys: ['k/1.jpg'],
  provider: 'stub',
  model: 'stub-deterministic-v1',
  status: 'complete',
  error: null,
  retryCount: 0,
  requestedAt: '2026-05-24T00:00:00.000Z',
  completedAt: '2026-05-24T00:00:01.000Z',
  createdAt: '2026-05-24T00:00:00.000Z',
  updatedAt: '2026-05-24T00:00:01.000Z',
};

const finding: DamageFindingDto = {
  id: '00000000-0000-7000-8000-000000000002',
  tenantId: analysis.tenantId,
  analysisId: analysis.id,
  area: 'front_bumper',
  severity: 'moderate',
  confidencePct: 88,
  description: 'Cracked bumper cover',
  boundingBox: { photoKey: 'k/1.jpg', x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
  operatorSeverity: null,
  operatorNote: null,
  isDismissed: false,
  overriddenBy: null,
  overriddenAt: null,
  createdAt: '2026-05-24T00:00:01.000Z',
  updatedAt: '2026-05-24T00:00:01.000Z',
};

const isPdf = (buf: Buffer) => buf.length > 100 && buf.subarray(0, 5).toString('ascii') === '%PDF-';

describe('DamageReportPdfService', () => {
  it('renders an analysis report PDF (EN)', async () => {
    const buf = await svc.renderAnalysisReport({
      analysis,
      findings: [finding],
      context: {
        jobReference: analysis.jobId,
        vehicleDescription: '2019 Toyota Camry',
        operatorName: 'op',
      },
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('renders an analysis report PDF with no findings', async () => {
    const buf = await svc.renderAnalysisReport({
      analysis,
      findings: [],
      context: { jobReference: analysis.jobId, vehicleDescription: 'Vehicle', operatorName: 'op' },
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('renders a comparison report PDF (ES)', async () => {
    const comparison: DamageComparisonDto = {
      id: '00000000-0000-7000-8000-000000000003',
      tenantId: analysis.tenantId,
      jobId: analysis.jobId,
      preAnalysisId: '00000000-0000-7000-8000-000000000004',
      postAnalysisId: analysis.id,
      newDamageFindings: [],
      comparisonSummary: '1 new, 0 pre-existing, 0 inconclusive (confidence ≥ 65%)',
      confidenceThreshold: 0.65,
      generatedAt: '2026-05-24T00:00:02.000Z',
      createdAt: '2026-05-24T00:00:02.000Z',
      updatedAt: '2026-05-24T00:00:02.000Z',
    };
    const result: CompareResult = {
      newDamage: [
        {
          area: 'front_bumper',
          severity: 'moderate',
          confidencePct: 88,
          priorSeverity: null,
          description: 'Cracked bumper cover',
          boundingBox: null,
          reason: 'no pre-tow damage recorded in front_bumper',
        },
      ],
      preExisting: [],
      inconclusive: [],
    };
    const buf = await svc.renderComparisonReport({
      comparison,
      result,
      context: {
        jobReference: comparison.jobId,
        vehicleDescription: '2019 Toyota Camry',
        operatorName: 'op',
        language: 'es',
      },
    });
    expect(isPdf(buf)).toBe(true);
  });
});
