import { describe, expect, it } from 'vitest';
import { RPO_SECONDS, RTO_MINUTES, quarterLabel, renderDrillTemplate } from './dr-drill';

describe('dr-drill template', () => {
  it('carries the S44 RPO/RTO targets', () => {
    expect(RPO_SECONDS).toBe(60);
    expect(RTO_MINUTES).toBe(15);
  });

  it('labels the quarter', () => {
    expect(quarterLabel(new Date('2026-01-15T00:00:00Z'))).toBe('2026-Q1');
    expect(quarterLabel(new Date('2026-11-15T00:00:00Z'))).toBe('2026-Q4');
  });

  it('renders the runbook with measurements + sign-off', () => {
    const md = renderDrillTemplate(new Date('2026-05-24T00:00:00Z'));
    expect(md).toContain('# Disaster-Recovery Drill Record — 2026-Q2');
    expect(md).toContain('RPO 60s');
    expect(md).toContain('RTO 15min');
    expect(md).toContain('Failback');
    expect(md).toContain('Sign-off');
  });
});
