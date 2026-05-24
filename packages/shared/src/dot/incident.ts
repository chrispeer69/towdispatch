/**
 * Incident/accident register contracts — Full DOT Compliance, Session 37
 * (49 CFR 390.15).
 */
import { z } from 'zod';

export const dotIncidentSeverityValues = ['property_damage', 'injury', 'fatality'] as const;
export type DotIncidentSeverity = (typeof dotIncidentSeverityValues)[number];

export const dotIncidentReportSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  driverId: z.string().uuid().nullable(),
  truckId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime(),
  locationText: z.string().nullable(),
  severity: z.enum(dotIncidentSeverityValues),
  fatalities: z.number().int(),
  injuries: z.number().int(),
  hazmatRelease: z.boolean(),
  towedAway: z.boolean(),
  narrative: z.string().nullable(),
  dotReportable: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DotIncidentReportDto = z.infer<typeof dotIncidentReportSchema>;

export const recordIncidentSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    driverId: z.string().uuid().optional(),
    truckId: z.string().uuid().optional(),
    occurredAt: z.string().datetime(),
    locationText: z.string().max(300).optional(),
    severity: z.enum(dotIncidentSeverityValues).default('property_damage'),
    fatalities: z.number().int().min(0).max(1000).default(0),
    injuries: z.number().int().min(0).max(1000).default(0),
    hazmatRelease: z.boolean().default(false),
    towedAway: z.boolean().default(false),
    narrative: z.string().max(20_000).optional(),
    // Operator may override the auto-determination; when omitted the
    // service derives it (fatality OR injury OR towed_away).
    dotReportable: z.boolean().optional(),
  })
  .strict();
export type RecordIncidentPayload = z.infer<typeof recordIncidentSchema>;
