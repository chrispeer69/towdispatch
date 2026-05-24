/**
 * Audit-packet + report contracts — Full DOT Compliance, Session 37.
 *
 * The audit packet itself is a binary PDF (no JSON DTO); this file carries
 * the request query and the read-model shapes for the three reports and
 * for the DVIR section, which is sourced from the existing `dvirs` table.
 */
import { z } from 'zod';
import { dotHosViolationSchema } from './hos';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const auditPacketQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
  })
  .strict()
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type AuditPacketQuery = z.infer<typeof auditPacketQuerySchema>;

/** A defect on an open DVIR (read from the existing `dvirs` table). */
export const dotOpenDvirDefectSchema = z.object({
  component: z.string(),
  severity: z.string(),
  notes: z.string().nullable(),
});
export type DotOpenDvirDefect = z.infer<typeof dotOpenDvirDefectSchema>;

/** "DVIR defects open" report row + audit-packet DVIR section row. */
export const dotOpenDvirSchema = z.object({
  dvirId: z.string().uuid(),
  truckId: z.string().uuid(),
  truckUnit: z.string().nullable(),
  driverId: z.string().uuid(),
  driverName: z.string(),
  type: z.string(),
  submittedAt: z.string().datetime(),
  status: z.string(),
  defects: z.array(dotOpenDvirDefectSchema),
});
export type DotOpenDvirDto = z.infer<typeof dotOpenDvirSchema>;

/** "HOS violations by driver, last 90 days" report row. */
export const dotHosViolationReportRowSchema = z.object({
  driverId: z.string().uuid(),
  driverName: z.string(),
  violationCount: z.number().int(),
  violations: z.array(dotHosViolationSchema),
});
export type DotHosViolationReportRow = z.infer<typeof dotHosViolationReportRowSchema>;
