/**
 * EV Recovery (Session 48) — battery thermal-event contracts.
 *
 * severity drives the escalation matrix in the pure engine
 * (thermalEventEscalation). Conservative posture: smoke / venting / sparking /
 * flames trigger the full response (fire dept + hazmat + evacuation + scene
 * lockdown). See SESSION_48_DECISIONS.md for the matrix rationale.
 */
import { z } from 'zod';

export const evThermalSeverityValues = [
  'odor',
  'swelling',
  'smoke',
  'venting',
  'sparking',
  'flames',
] as const;
export type EvThermalSeverity = (typeof evThermalSeverityValues)[number];

// Output of thermalEventEscalation(severity).
export const evThermalEscalationSchema = z.object({
  fireDeptNotify: z.boolean(),
  hazmatNotify: z.boolean(),
  evacRequired: z.boolean(),
  sceneLockdown: z.boolean(),
});
export type EvThermalEscalation = z.infer<typeof evThermalEscalationSchema>;

export const evThermalEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  observedAt: z.string().datetime(),
  severity: z.enum(evThermalSeverityValues),
  actionTaken: z.string().nullable(),
  hazmatCalled: z.boolean(),
  fireDeptCalled: z.boolean(),
  customerEvacuated: z.boolean(),
  sceneSecured: z.boolean(),
  photoKeys: z.array(z.string()),
  // The escalation the engine recommends for this severity, surfaced so the
  // operator/driver UI can prompt the required actions.
  escalation: evThermalEscalationSchema,
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type EvThermalEventDto = z.infer<typeof evThermalEventSchema>;

export const reportThermalEventSchema = z
  .object({
    severity: z.enum(evThermalSeverityValues),
    actionTaken: z.string().max(2000).optional(),
    hazmatCalled: z.boolean().optional(),
    fireDeptCalled: z.boolean().optional(),
    customerEvacuated: z.boolean().optional(),
    sceneSecured: z.boolean().optional(),
    photoKeys: z.array(z.string().max(1024)).max(20).optional(),
    observedAt: z.string().datetime().optional(),
  })
  .strict();
export type ReportThermalEventPayload = z.infer<typeof reportThermalEventSchema>;
