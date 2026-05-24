import { describe, expect, it } from 'vitest';
import {
  ACTION_LABEL,
  STATUS_LABEL,
  STEP_LABEL,
  dueTone,
  formatCents,
  formatDay,
} from './lien-ui-helpers';

describe('lien-ui-helpers', () => {
  it('formats cents as USD', () => {
    expect(formatCents(225_000)).toBe('$2,250.00');
    expect(formatCents(0)).toBe('$0.00');
  });

  it('formats a day and tolerates null', () => {
    expect(formatDay(null)).toBe('—');
    expect(formatDay('2026-01-15T00:00:00.000Z')).toContain('2026');
  });

  it('labels every status, step, and action', () => {
    expect(STATUS_LABEL.ready_for_sale).toBe('Ready for sale');
    expect(STEP_LABEL.publication_complete).toBe('Publication complete');
    expect(ACTION_LABEL.send_owner_notice).toBe('Send owner notice');
  });

  it('tones overdue, soon, and far-off due dates differently', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    expect(dueTone('2026-01-05T00:00:00.000Z', now)).toContain('status-warning');
    expect(dueTone('2026-01-11T00:00:00.000Z', now)).toContain('accent-orange');
    expect(dueTone('2026-02-10T00:00:00.000Z', now)).toContain('text-secondary');
    expect(dueTone(null, now)).toContain('text-secondary');
  });
});
