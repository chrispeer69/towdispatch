import { ROLES } from '@towcommand/shared';
import { describe, expect, it } from 'vitest';
import { rolesForReport } from './report-rbac.js';

describe('rolesForReport', () => {
  it('excludes dispatcher from revenue and tax', () => {
    expect(rolesForReport('revenue')).not.toContain(ROLES.DISPATCHER);
    expect(rolesForReport('tax')).not.toContain(ROLES.DISPATCHER);
  });

  it('excludes accounting from dispatch-performance and compliance', () => {
    expect(rolesForReport('dispatch-performance')).not.toContain(ROLES.ACCOUNTING);
    expect(rolesForReport('compliance')).not.toContain(ROLES.ACCOUNTING);
  });

  it('grants drivers access only to driver-performance and commission', () => {
    expect(rolesForReport('driver-performance')).toContain(ROLES.DRIVER);
    expect(rolesForReport('commission')).toContain(ROLES.DRIVER);
    expect(rolesForReport('pnl')).not.toContain(ROLES.DRIVER);
    expect(rolesForReport('revenue')).not.toContain(ROLES.DRIVER);
    expect(rolesForReport('tax')).not.toContain(ROLES.DRIVER);
  });

  it('always grants auditor read access', () => {
    for (const id of [
      'dispatch-performance',
      'driver-performance',
      'revenue',
      'storage',
      'pnl',
      'commission',
      'tax',
      'compliance',
    ] as const) {
      expect(rolesForReport(id)).toContain(ROLES.AUDITOR);
    }
  });
});
