/**
 * PDF smoke test — renders every state × form-type (all 50 states + DC × 2 =
 * 102 logical templates) and asserts a non-empty PDF document comes out.
 *
 * PDFKit deflates its text streams, so the rendered Buffer is not greppable;
 * the case-id + statute-citation content assertion runs against the pure
 * buildLienNoticeContent() builder that draw() sources its strings from, so
 * the document and the assertion can never drift. Pure (no DB / no Nest DI).
 */
import { lienFormTypeValues, lienStateValues } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { LIEN_STATE_RULES } from '../state-rules.config';
import { LienFormPdfService, buildLienNoticeContent } from './lien-form.renderer';

const svc = new LienFormPdfService();
const CASE_ID = '00000000-0000-0000-0000-0000000000aa';

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

describe('LienFormPdfService — renders all 50 states + DC × 2 form types (102 templates)', () => {
  for (const state of lienStateValues) {
    for (const formType of lienFormTypeValues) {
      const input = {
        formType,
        state,
        rules: LIEN_STATE_RULES[state],
        tenantName: 'Acme Towing',
        caseId: CASE_ID,
        openedAt: new Date('2026-01-01T00:00:00.000Z'),
        vehicleValueTier: 'mid',
        estimatedValueCents: 700_000,
        impound,
        recipientName: 'Jane Owner',
        recipientAddress: '123 Main St, Austin, TX',
      } as const;

      it(`renders a valid PDF for ${state} / ${formType}`, async () => {
        const buf = await svc.renderForm(input);
        expect(buf.length).toBeGreaterThan(500);
        // PDF magic bytes.
        expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      });

      it(`embeds the case id and statute citation for ${state} / ${formType}`, () => {
        const content = buildLienNoticeContent(input);
        expect(content.caseId).toBe(CASE_ID);
        expect(content.footer).toContain(CASE_ID);
        // The notice cites the governing statute in both the header and body.
        expect(content.statute).toBe(LIEN_STATE_RULES[state].statute);
        expect(content.statute.length).toBeGreaterThan(8);
        expect(content.noticeBody).toContain(content.statute);
        expect(content.title).toContain(state);
      });
    }
  }
});
