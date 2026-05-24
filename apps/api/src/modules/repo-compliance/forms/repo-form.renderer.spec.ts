/**
 * PDF smoke test — renders every state × form-type (all 50 states + DC × 3 =
 * 153 logical templates) and asserts a non-empty PDF document comes out.
 *
 * PDFKit deflates its text streams, so the rendered Buffer is not greppable;
 * the case-id + statute-citation content assertion runs against the pure
 * buildRepoNoticeContent() builder that draw() sources its strings from, so
 * the document and the assertion can never drift. Pure (no DB / no Nest DI).
 */
import { repoFormTypeValues, repoStateValues } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { REPO_STATE_RULES } from '../state-rules.config';
import { RepoFormPdfService, buildRepoNoticeContent } from './repo-form.renderer';

const svc = new RepoFormPdfService();
const CASE_ID = '00000000-0000-0000-0000-0000000000bb';

const collateral = {
  vehicleDescription: '2019 Silver Honda Accord',
  vehicleVin: '1HGCV1F30KA000000',
  licensePlate: 'XYZ789',
  licenseState: 'CA',
  defaultDate: '2026-01-01T00:00:00.000Z',
  repossessedAt: '2026-02-01T00:00:00.000Z',
  payoffAmountCents: 1_850_000,
  pastDueAmountCents: 95_000,
  saleProceedsCents: 1_200_000,
};

describe('RepoFormPdfService — renders all 50 states + DC × 3 form types (153 templates)', () => {
  for (const state of repoStateValues) {
    for (const formType of repoFormTypeValues) {
      const input = {
        formType,
        state,
        rules: REPO_STATE_RULES[state],
        creditorName: 'Acme Auto Finance LLC',
        caseId: CASE_ID,
        noticeDate: new Date('2026-02-05T00:00:00.000Z'),
        collateral,
        recipientName: 'Jordan Debtor',
        recipientAddress: '500 Oak Ave, Sacramento, CA',
      } as const;

      it(`renders a valid PDF for ${state} / ${formType}`, async () => {
        const buf = await svc.renderForm(input);
        expect(buf.length).toBeGreaterThan(500);
        // PDF magic bytes.
        expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      });

      it(`embeds the case id and statute citation for ${state} / ${formType}`, () => {
        const content = buildRepoNoticeContent(input);
        expect(content.caseId).toBe(CASE_ID);
        expect(content.footer).toContain(CASE_ID);
        // The notice cites the governing statute in both the header and body.
        expect(content.statute).toBe(REPO_STATE_RULES[state].statute);
        expect(content.statute.length).toBeGreaterThan(8);
        expect(content.noticeBody).toContain(content.statute);
        expect(content.title).toContain(state);
      });
    }
  }
});
