/**
 * PDF smoke test — renders every state × form-type (10 states × 2 = 20 logical
 * templates) and asserts a valid PDF document comes out.
 *
 * PDFKit deflates its text streams, so the rendered Buffer is not greppable;
 * the case-id + statute-citation content assertion runs against the pure
 * buildRepoNoticeContent() builder that draw() sources its strings from, so the
 * document and the assertion can never drift. Pure (no DB / no Nest DI).
 */
import { repoFormTypeValues, repoStateValues } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { REPO_STATE_RULES } from '../compliance/state-rules.config';
import { RepoFormPdfService, buildRepoNoticeContent } from './repo-form.renderer';

const svc = new RepoFormPdfService();
const CASE_ID = '00000000-0000-0000-0000-0000000000bb';
const RECOVERED_AT = new Date('2026-03-01T00:00:00.000Z');

describe('RepoFormPdfService — renders all 10 states × 2 form types (20 templates)', () => {
  for (const state of repoStateValues) {
    for (const formType of repoFormTypeValues) {
      const input = {
        formType,
        state,
        rules: REPO_STATE_RULES[state],
        tenantName: 'Acme Recovery',
        repoCaseId: CASE_ID,
        recoveredAt: RECOVERED_AT,
        debtorName: 'Jane Debtor',
        debtorAddress: '123 Main St, Anytown',
        vehicleDescription: '2019 Gray Honda Civic',
        vehicleVin: '2HGFC2F50KH000000',
        licensePlate: 'XYZ789',
        accruedChargesCents: 142_500,
      } as const;

      it(`renders a valid PDF for ${state} / ${formType}`, async () => {
        const buf = await svc.renderForm(input);
        expect(buf.length).toBeGreaterThan(500);
        expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      });

      it(`embeds the case id and statute citation for ${state} / ${formType}`, () => {
        const content = buildRepoNoticeContent(input);
        expect(content.repoCaseId).toBe(CASE_ID);
        expect(content.footer).toContain(CASE_ID);
        expect(content.statute).toBe(REPO_STATE_RULES[state].statute);
        expect(content.statute.length).toBeGreaterThan(8);
        expect(content.noticeBody).toContain(content.statute);
        expect(content.title).toContain(state);
        // Personal-property hold date is present on every notice.
        expect(content.personalPropertyHoldUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    }
  }
});
