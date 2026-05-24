import { describe, expect, it } from 'vitest';
import {
  certStatusBadgeClass,
  certTypeLabel,
  formatCents,
  gvwrClassLabel,
  incidentLabel,
  lbsLabel,
  multiplierLabel,
} from './hd-ui-helpers';

describe('hd-ui-helpers', () => {
  it('formats cents as USD', () => {
    expect(formatCents(123_450)).toBe('$1,234.50');
    expect(formatCents(0)).toBe('$0.00');
  });

  it('labels cert + incident types', () => {
    expect(certTypeLabel('hd_operator')).toBe('HD Operator');
    expect(certTypeLabel('cdl_a')).toBe('CDL-A');
    expect(incidentLabel('load_shift')).toBe('Load shift');
  });

  it('labels GVWR class and pounds with nulls', () => {
    expect(gvwrClassLabel(8)).toBe('Class 8');
    expect(gvwrClassLabel(null)).toBe('—');
    expect(lbsLabel(80_000)).toBe('80,000 lb');
    expect(lbsLabel(null)).toBe('—');
  });

  it('maps cert status to a badge class', () => {
    expect(certStatusBadgeClass('expired')).toMatch(/danger/);
    expect(certStatusBadgeClass('expiring')).toMatch(/orange/);
    expect(certStatusBadgeClass('valid')).toMatch(/success/);
  });

  it('formats multipliers (1 = none)', () => {
    expect(multiplierLabel(1)).toBe('—');
    expect(multiplierLabel(1.5)).toBe('1.5×');
  });
});
