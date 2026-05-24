/**
 * Hours-of-service contracts — Full DOT Compliance, Session 37.
 * Property-carrying ruleset only this session (49 CFR 395.3 / 395.8).
 */
import { z } from 'zod';

export const dotHosStatusValues = [
  'off_duty',
  'sleeper',
  'driving',
  'on_duty_not_driving',
] as const;
export type DotHosStatus = (typeof dotHosStatusValues)[number];

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const dotHosLogSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  logDate: z.string(),
  status: z.enum(dotHosStatusValues),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().nullable(),
  milesDriven: z.number().int().nullable(),
  vehicleId: z.string().uuid().nullable(),
  locationText: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DotHosLogDto = z.infer<typeof dotHosLogSchema>;

export const recordHosEntrySchema = z
  .object({
    driverId: z.string().uuid(),
    logDate: dateString,
    status: z.enum(dotHosStatusValues),
    startAt: z.string().datetime(),
    endAt: z.string().datetime().optional(),
    milesDriven: z.number().int().min(0).max(10_000).optional(),
    vehicleId: z.string().uuid().optional(),
    locationText: z.string().max(300).optional(),
    remarks: z.string().max(2_000).optional(),
  })
  .strict()
  .refine((v) => v.endAt === undefined || v.endAt >= v.startAt, {
    message: 'endAt must be at or after startAt',
    path: ['endAt'],
  });
export type RecordHosEntryPayload = z.infer<typeof recordHosEntrySchema>;

export const dotHosViolationRuleValues = [
  'driving_limit_11h',
  'duty_window_14h',
  'break_30min',
  'cycle_60h_7d',
  'cycle_70h_8d',
] as const;
export type DotHosViolationRule = (typeof dotHosViolationRuleValues)[number];

export const dotHosViolationSeverityValues = ['warning', 'violation'] as const;
export type DotHosViolationSeverity = (typeof dotHosViolationSeverityValues)[number];

export const dotHosViolationSchema = z.object({
  rule: z.enum(dotHosViolationRuleValues),
  at: z.string().datetime(),
  severity: z.enum(dotHosViolationSeverityValues),
  detail: z.string(),
});
export type DotHosViolationDto = z.infer<typeof dotHosViolationSchema>;

export const dotHosWeekResultSchema = z.object({
  driverId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  totalDrivingMinutes: z.number().int(),
  totalOnDutyMinutes: z.number().int(),
  violations: z.array(dotHosViolationSchema),
});
export type DotHosWeekResultDto = z.infer<typeof dotHosWeekResultSchema>;

export const listHosFilterSchema = z
  .object({
    driverId: z.string().uuid().optional(),
    from: dateString.optional(),
    to: dateString.optional(),
  })
  .strict();
export type ListHosFilter = z.infer<typeof listHosFilterSchema>;
