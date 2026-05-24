import { describe, expect, it } from 'vitest';
import { findCardFieldLogging, findPanCandidates } from './verify-no-pan-logs';

describe('findPanCandidates', () => {
  it('positive: flags a Luhn-valid non-test PAN', () => {
    // 4000000000000002 is Luhn-valid and NOT in the test-card allowlist.
    const hits = findPanCandidates('const leak = "4000000000000002";');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.masked).toBe('400000…0002');
  });

  it('allowlist: ignores well-known public test cards', () => {
    expect(findPanCandidates('card 4242424242424242 in a fixture')).toHaveLength(0);
    expect(findPanCandidates('4111111111111111')).toHaveLength(0);
  });

  it('negative: ignores non-Luhn long digit runs and short numbers', () => {
    expect(findPanCandidates('order id 1234567890123456')).toHaveLength(0); // not Luhn-valid
    expect(findPanCandidates('phone 5551234567')).toHaveLength(0); // too short
  });
});

describe('findCardFieldLogging', () => {
  it('positive: a logger call carrying a card field is a hit', () => {
    expect(findCardFieldLogging('logger.info({ card_number: x });')).toHaveLength(1);
    expect(findCardFieldLogging('console.log("cvv", cvv);')).toHaveLength(1);
  });

  it('negative: logger without card fields, or card field without logger', () => {
    expect(findCardFieldLogging('logger.info("charge created");')).toHaveLength(0);
    expect(findCardFieldLogging('const card_number = stripeToken;')).toHaveLength(0);
  });
});
