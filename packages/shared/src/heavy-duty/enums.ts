/**
 * Heavy-Duty Specialist (Session 36) — shared enums. Mirror the DB CHECK
 * constraints in packages/db/sql/0039_heavy_duty.sql and the Drizzle enum
 * arrays in packages/db/src/schema/hd-*.ts. Kept in sync by hand (same
 * convention as the impound module).
 */

export const hdDriverCertTypeValues = [
  'hd_operator',
  'rotator',
  'hazmat',
  'cdl_a',
  'cdl_b',
] as const;
export type HdDriverCertType = (typeof hdDriverCertTypeValues)[number];

export const hdIncidentTypeValues = [
  'overturn',
  'underride',
  'jackknife',
  'load_shift',
  'fire',
  'water',
  'other',
] as const;
export type HdIncidentType = (typeof hdIncidentTypeValues)[number];

/** Cert lifecycle status, derived from expires_at relative to "today". */
export const hdCertStatusValues = ['valid', 'expiring', 'expired', 'unknown'] as const;
export type HdCertStatus = (typeof hdCertStatusValues)[number];

/** A YYYY-MM-DD calendar date crossing the wire as a string. */
export const HD_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
