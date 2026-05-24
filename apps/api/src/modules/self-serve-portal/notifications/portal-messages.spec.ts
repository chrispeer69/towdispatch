import { describe, expect, it } from 'vitest';
import {
  formatUsd,
  magicLinkEmail,
  magicLinkSms,
  paymentReceiptEmail,
  pickupReminderSms,
  readyForGateSms,
} from './portal-messages.js';

describe('portal-messages', () => {
  it('formats USD cents', () => {
    expect(formatUsd(12_345)).toBe('$123.45');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('magic-link SMS includes the link, the yard, and an expiry hint', () => {
    const s = magicLinkSms({ tenantName: 'Acme Towing', link: 'https://x/recover/verify?token=t' });
    expect(s).toContain('Acme Towing');
    expect(s).toContain('https://x/recover/verify?token=t');
    expect(s).toMatch(/expire/i);
  });

  it('magic-link email has subject + body with the link', () => {
    const e = magicLinkEmail({ tenantName: 'Acme', link: 'https://x' });
    expect(e.subject).toContain('Acme');
    expect(e.body).toContain('https://x');
  });

  it('receipt email tells the owner to bring matching photo ID', () => {
    const e = paymentReceiptEmail({
      tenantName: 'Acme',
      amountFormatted: '$50.00',
      caseNumber: 'C1',
    });
    expect(e.subject).toMatch(/payment/i);
    expect(e.body).toContain('$50.00');
    expect(e.body).toMatch(/photo ID/i);
  });

  it('ready-for-gate + reminder SMS reference the case and pickup', () => {
    expect(readyForGateSms({ tenantName: 'Acme', caseNumber: 'C1' })).toMatch(/ready for pickup/i);
    expect(pickupReminderSms({ tenantName: 'Acme', caseNumber: 'C1' })).toMatch(/reminder/i);
  });
});
