import { describe, expect, it } from 'vitest';
import {
  BAND_LABEL,
  DISPUTE_STATUS_LABEL,
  SIGNAL_LABEL,
  formatCents,
  formatDay,
  formatWinRate,
  scoreTone,
} from './fraud-ui-helpers';

describe('fraud-ui-helpers', () => {
  it('formats cents as USD and tolerates null', () => {
    expect(formatCents(225_000)).toBe('$2,250.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(null)).toBe('—');
  });

  it('formats a day and tolerates null', () => {
    expect(formatDay(null)).toBe('—');
    expect(formatDay('2026-01-15T00:00:00.000Z')).toContain('2026');
  });

  it('labels every band, signal, and dispute status', () => {
    expect(BAND_LABEL.critical).toBe('Critical');
    expect(SIGNAL_LABEL.duplicate_invoice).toBe('Duplicate invoice');
    expect(SIGNAL_LABEL.bill_to_storage_acceleration).toBe('Storage acceleration');
    expect(DISPUTE_STATUS_LABEL.won).toBe('Won');
  });

  it('escalates score tone across the band boundaries', () => {
    expect(scoreTone(10)).toContain('text-secondary');
    expect(scoreTone(45)).toContain('accent-orange');
    expect(scoreTone(70)).toContain('status-warning');
    expect(scoreTone(90)).toContain('font-bold');
  });

  it('formats a win rate and tolerates null', () => {
    expect(formatWinRate(60)).toBe('60%');
    expect(formatWinRate(null)).toBe('—');
  });
});
