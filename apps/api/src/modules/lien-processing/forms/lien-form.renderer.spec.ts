/**
 * PDF smoke test — renders each state × form-type (the 20 logical templates)
 * and asserts a non-empty PDF document comes out. Pure (no DB / no Nest DI).
 */
import { lienFormTypeValues, lienStateValues } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { LIEN_STATE_RULES } from '../state-rules.config';
import { LienFormPdfService } from './lien-form.renderer';

const svc = new LienFormPdfService();

const impound = {
  impoundRecordId: '00000000-0000-0000-0000-000000000001',
  vehicleDescription: '2018 Blue Ford F-150',
  licensePlate: 'ABC123',
  licenseState: 'TX',
  vehicleVin: '1FTEW1E50JFA00000',
  yardName: 'North Lot',
  arrivedAt: '2026-01-01T00:00:00.000Z',
  daysStored: 45,
  accruedFeeCents: 225_000,
};

describe('LienFormPdfService — renders all 10 states × 2 form types', () => {
  for (const state of lienStateValues) {
    for (const formType of lienFormTypeValues) {
      it(`renders a PDF for ${state} / ${formType}`, async () => {
        const buf = await svc.renderForm({
          formType,
          state,
          rules: LIEN_STATE_RULES[state],
          tenantName: 'Acme Towing',
          caseId: '00000000-0000-0000-0000-0000000000aa',
          openedAt: new Date('2026-01-01T00:00:00.000Z'),
          vehicleValueTier: 'mid',
          estimatedValueCents: 700_000,
          impound,
          recipientName: 'Jane Owner',
          recipientAddress: '123 Main St, Austin, TX',
        });
        expect(buf.length).toBeGreaterThan(500);
        // PDF magic bytes.
        expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      });
    }
  }
});
