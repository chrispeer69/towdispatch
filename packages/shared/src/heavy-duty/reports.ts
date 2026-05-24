/**
 * Heavy-Duty Specialist (Session 36) — report response DTOs. These reports
 * are served by the HD module's own /heavy-duty/reports/* endpoints (not
 * wired into the central reporting registry — see SESSION_36_DECISIONS.md).
 */
import { z } from 'zod';
import { hdCertStatusValues, hdDriverCertTypeValues } from './enums';

/** HD jobs by month: count, revenue (final invoice), average ticket. */
export const hdJobsByMonthRowSchema = z.object({
  month: z.string(), // YYYY-MM
  jobCount: z.number().int(),
  revenueCents: z.number().int(),
  avgTicketCents: z.number().int(),
});
export type HdJobsByMonthRowDto = z.infer<typeof hdJobsByMonthRowSchema>;

export const hdJobsByMonthReportSchema = z.object({
  rows: z.array(hdJobsByMonthRowSchema),
  totalJobs: z.number().int(),
  totalRevenueCents: z.number().int(),
});
export type HdJobsByMonthReportDto = z.infer<typeof hdJobsByMonthReportSchema>;

/** Cert-expiry roster (next N days, default 60). */
export const hdCertExpiryRowSchema = z.object({
  driverId: z.string().uuid(),
  driverName: z.string(),
  certType: z.enum(hdDriverCertTypeValues),
  expiresAt: z.string().nullable(),
  daysUntilExpiry: z.number().int().nullable(),
  status: z.enum(hdCertStatusValues),
});
export type HdCertExpiryRowDto = z.infer<typeof hdCertExpiryRowSchema>;

export const hdCertExpiryReportSchema = z.object({
  windowDays: z.number().int(),
  rows: z.array(hdCertExpiryRowSchema),
  expiringCount: z.number().int(),
  expiredCount: z.number().int(),
});
export type HdCertExpiryReportDto = z.infer<typeof hdCertExpiryReportSchema>;

/** Equipment utilization: rotator jobs / total HD jobs. */
export const hdEquipmentUtilizationReportSchema = z.object({
  totalHdJobs: z.number().int(),
  rotatorJobs: z.number().int(),
  rotatorUtilizationPct: z.number(),
});
export type HdEquipmentUtilizationReportDto = z.infer<typeof hdEquipmentUtilizationReportSchema>;
