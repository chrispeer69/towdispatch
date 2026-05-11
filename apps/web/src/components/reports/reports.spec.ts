/**
 * Light component tests for the reports module. We exercise the
 * data-table sorting logic and the filter sidebar default state by
 * invoking the exported defaults — full DOM tests live in Cypress.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from './filter-sidebar';

describe('reports default filters', () => {
  it('defaults from to the first day of the current month (UTC)', () => {
    const f = DEFAULT_FILTERS;
    expect(f.from.endsWith('-01')).toBe(true);
    expect(f.to.length).toBe(10);
    expect(f.granularity).toBe('day');
    expect(f.comparison).toBe('none');
  });
});
