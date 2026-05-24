/**
 * Driver-qualification (DQ-file) contracts — Full DOT Compliance,
 * Session 37.
 *
 * The DQ file spans two tables: the `drivers` row (license, CDL class,
 * medical card, drug-test and road-test dates) and the
 * dot_driver_qualifications extension (file status, employment application,
 * MVR). The DQ-view DTO merges both plus the computed completeness so the
 * web dashboard and the audit-packet roster render from one shape.
 */
import { z } from 'zod';

export const dotDqFileStatusValues = ['incomplete', 'complete', 'on_hold'] as const;
export type DotDqFileStatus = (typeof dotDqFileStatusValues)[number];

/** The dot_driver_qualifications extension row. */
export const dotDriverQualificationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  dqFileStatus: z.enum(dotDqFileStatusValues),
  employmentAppSignedAt: z.string().datetime().nullable(),
  mvrPulledAt: z.string().datetime().nullable(),
  mvrExpiresAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DotDriverQualificationDto = z.infer<typeof dotDriverQualificationSchema>;

/** Upsert payload for a driver's DQ extension. */
export const recordDqEventSchema = z
  .object({
    driverId: z.string().uuid(),
    dqFileStatus: z.enum(dotDqFileStatusValues).optional(),
    employmentAppSignedAt: z.string().datetime().nullable().optional(),
    mvrPulledAt: z.string().datetime().nullable().optional(),
    mvrExpiresAt: z.string().datetime().nullable().optional(),
    notes: z.string().max(20_000).nullable().optional(),
  })
  .strict();
export type RecordDqEventPayload = z.infer<typeof recordDqEventSchema>;

/** A single missing or expiring DQ-file item. */
export const dqFileItemValues = [
  'employment_application',
  'drivers_license',
  'license_expiry',
  'medical_certificate',
  'mvr',
  'drug_test',
  'road_test',
] as const;
export type DqFileItem = (typeof dqFileItemValues)[number];

export const dqExpiringItemSchema = z.object({
  item: z.enum(dqFileItemValues),
  expiresAt: z.string(), // date or datetime; presentation-only
  daysLeft: z.number().int(),
});
export type DqExpiringItem = z.infer<typeof dqExpiringItemSchema>;

/** Merged DQ view (drivers + extension + computed completeness). */
export const dotDriverDqViewSchema = z.object({
  driverId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  employeeNumber: z.string().nullable(),
  cdlClass: z.string(),
  licenseNumber: z.string().nullable(),
  licenseState: z.string().nullable(),
  licenseExpiresAt: z.string().nullable(),
  medicalCardExpiresAt: z.string().nullable(),
  drugTestLastAt: z.string().nullable(),
  roadTestCompletedAt: z.string().nullable(),
  employmentAppSignedAt: z.string().datetime().nullable(),
  mvrPulledAt: z.string().datetime().nullable(),
  mvrExpiresAt: z.string().datetime().nullable(),
  dqFileStatus: z.enum(dotDqFileStatusValues),
  complete: z.boolean(),
  missing: z.array(z.enum(dqFileItemValues)),
  expiring: z.array(dqExpiringItemSchema),
});
export type DotDriverDqViewDto = z.infer<typeof dotDriverDqViewSchema>;
