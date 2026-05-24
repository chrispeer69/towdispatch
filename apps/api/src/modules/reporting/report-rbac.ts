/**
 * Per-report role allowlists.
 *
 * Driver         — only driver-performance and commission (narrowed to their
 *                  own row by ReportingService.narrowForDriverRole).
 * Dispatcher     — dispatch and driver behavior, no P&L / commission audit /
 *                  tax. Compliance yes (HOS exposure is dispatch-actionable).
 * Manager        — everything except billing-tier admin fields. Today the
 *                  reporting module has no admin-only fields, so manager =
 *                  full access.
 * Owner / Admin  — everything.
 * Accounting     — revenue, tax, commission, P&L. Not dispatch or driver.
 * Auditor        — everything, read-only. We don't enforce write-restrictions
 *                  here because the reporting module is read-only outside the
 *                  saved-reports CRUD (which auditors don't hit per the
 *                  controller route allowlist).
 */
import { ROLES, type ReportId, type Role } from '@ustowdispatch/shared';

const ALL: Role[] = [
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.DISPATCHER,
  ROLES.ACCOUNTING,
  ROLES.AUDITOR,
  ROLES.DRIVER,
];

const REPORT_ROLES: Record<ReportId, Role[]> = {
  'dispatch-performance': [
    ROLES.OWNER,
    ROLES.ADMIN,
    ROLES.MANAGER,
    ROLES.DISPATCHER,
    ROLES.AUDITOR,
  ],
  'driver-performance': [
    ROLES.OWNER,
    ROLES.ADMIN,
    ROLES.MANAGER,
    ROLES.DISPATCHER,
    ROLES.AUDITOR,
    ROLES.DRIVER,
  ],
  revenue: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR],
  storage: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR],
  pnl: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR],
  commission: [
    ROLES.OWNER,
    ROLES.ADMIN,
    ROLES.MANAGER,
    ROLES.ACCOUNTING,
    ROLES.AUDITOR,
    ROLES.DRIVER,
  ],
  tax: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR],
  compliance: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.AUDITOR],
};

export function rolesForReport(id: ReportId): Role[] {
  return REPORT_ROLES[id] ?? ALL;
}
