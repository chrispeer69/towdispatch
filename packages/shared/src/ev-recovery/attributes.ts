/**
 * EV Recovery (Session 48) — EV job-attribute contracts + the combined job
 * detail DTO.
 *
 * markJobEv flags a job as an EV recovery (creates the attributes row);
 * recordIntake fills in the on-scene charge-state + HV/tow-mode fields. The
 * detail DTO bundles the attributes with the computed equipment rules, the
 * matched OEM procedure, and the thermal-event / charge-stop history.
 */
import { z } from 'zod';
import { evChargeStopSchema } from './charge-stops';
import { evEquipmentRulesSchema } from './equipment';
import { evOemProcedureSchema } from './oem-procedures';
import { evThermalEventSchema } from './thermal-events';

export const evBatteryChemistryValues = ['li_ion', 'lfp', 'nicd', 'nimh', 'other'] as const;
export type EvBatteryChemistry = (typeof evBatteryChemistryValues)[number];

export const evJobAttributesSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  modelYear: z.number().int().nullable(),
  batteryChemistry: z.enum(evBatteryChemistryValues).nullable(),
  batteryKwh: z.number().nullable(),
  stateOfChargePct: z.number().int().nullable(),
  chargePortLocked: z.boolean(),
  hvIsolated: z.boolean(),
  towModeEngaged: z.boolean(),
  oemTowProcedureAcknowledged: z.boolean(),
  thermalEventObserved: z.boolean(),
  thermalEventNotes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EvJobAttributesDto = z.infer<typeof evJobAttributesSchema>;

// Intake fields. All optional so a tech can fill them in incrementally; the
// server upserts onto the single attributes row.
const intakeFields = {
  make: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  modelYear: z.number().int().min(1990).max(2100).optional(),
  batteryChemistry: z.enum(evBatteryChemistryValues).optional(),
  batteryKwh: z.number().min(0).max(9999).optional(),
  stateOfChargePct: z.number().int().min(0).max(100).optional(),
  chargePortLocked: z.boolean().optional(),
  hvIsolated: z.boolean().optional(),
  towModeEngaged: z.boolean().optional(),
  oemTowProcedureAcknowledged: z.boolean().optional(),
  thermalEventObserved: z.boolean().optional(),
  thermalEventNotes: z.string().max(5000).nullable().optional(),
};

// markJobEv: optionally seeds intake fields at creation.
export const markJobEvSchema = z.object(intakeFields).strict();
export type MarkJobEvPayload = z.infer<typeof markJobEvSchema>;

export const recordEvIntakeSchema = z.object(intakeFields).strict();
export type RecordEvIntakePayload = z.infer<typeof recordEvIntakeSchema>;

// GET /ev-recovery/jobs/:jobId — the full EV picture for a job.
export const evJobDetailSchema = z.object({
  attributes: evJobAttributesSchema,
  equipment: evEquipmentRulesSchema,
  oemProcedure: evOemProcedureSchema.nullable(),
  thermalEvents: z.array(evThermalEventSchema),
  chargeStops: z.array(evChargeStopSchema),
});
export type EvJobDetailDto = z.infer<typeof evJobDetailSchema>;
