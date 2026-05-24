/**
 * Heavy-Duty Specialist (Session 36) — hd_driver_certifications contracts.
 * driverId is a path param on the write surface. Recording a cert is an
 * upsert (one live row per (driver, cert_type)). issued_at / expires_at
 * cross the wire as YYYY-MM-DD strings.
 */
import { z } from 'zod';
import { HD_DATE_RE, hdDriverCertTypeValues } from './enums';

const hdDateString = z.string().regex(HD_DATE_RE, 'expected YYYY-MM-DD');

export const hdDriverCertificationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  certType: z.enum(hdDriverCertTypeValues),
  issuedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  docKey: z.string().nullable(),
  verifiedAt: z.string().datetime().nullable(),
  verifiedBy: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type HdDriverCertificationDto = z.infer<typeof hdDriverCertificationSchema>;

export const recordHdDriverCertSchema = z
  .object({
    certType: z.enum(hdDriverCertTypeValues),
    issuedAt: hdDateString.optional(),
    expiresAt: hdDateString.optional(),
    docKey: z.string().max(1024).optional(),
    /** When true the service stamps verified_at = now + verified_by = caller. */
    verified: z.boolean().default(false),
    notes: z.string().max(5000).optional(),
  })
  .strict()
  .refine((v) => !v.issuedAt || !v.expiresAt || v.expiresAt >= v.issuedAt, {
    message: 'expiresAt must not precede issuedAt',
    path: ['expiresAt'],
  });
export type RecordHdDriverCertPayload = z.infer<typeof recordHdDriverCertSchema>;
