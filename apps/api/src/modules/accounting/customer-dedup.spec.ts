import { describe, expect, it } from 'vitest';
import { findDuplicate } from './customer-dedup.js';

describe('findDuplicate', () => {
  it('matches case-insensitively on email', () => {
    const dup = findDuplicate({ displayName: 'X', email: 'Alice@example.COM', phone: null }, [
      { externalId: 'qbc-1', displayName: 'Alice', email: 'alice@example.com', phone: null },
    ]);
    expect(dup?.externalId).toBe('qbc-1');
  });

  it('matches on phone digits, ignoring formatting', () => {
    const dup = findDuplicate({ displayName: 'X', email: null, phone: '(555) 010-0' }, [
      { externalId: 'qbc-2', displayName: 'Alice', email: null, phone: '5550100' },
    ]);
    expect(dup?.externalId).toBe('qbc-2');
  });

  it('matches on normalized display name when email/phone are absent', () => {
    const dup = findDuplicate({ displayName: '  Alice   Hauler ', email: null, phone: null }, [
      { externalId: 'qbc-3', displayName: 'Alice Hauler', email: null, phone: null },
    ]);
    expect(dup?.externalId).toBe('qbc-3');
  });

  it('returns null when nothing matches', () => {
    const dup = findDuplicate({ displayName: 'Bob', email: 'bob@example.com', phone: '555-9999' }, [
      { externalId: 'qbc-4', displayName: 'Alice', email: 'alice@example.com', phone: '5550100' },
    ]);
    expect(dup).toBeNull();
  });

  it('ignores too-short phones (< 7 digits) as noise', () => {
    const dup = findDuplicate({ displayName: 'Charlie', email: null, phone: '555' }, [
      { externalId: 'qbc-5', displayName: 'Other', email: null, phone: '555' },
    ]);
    expect(dup).toBeNull();
  });
});
