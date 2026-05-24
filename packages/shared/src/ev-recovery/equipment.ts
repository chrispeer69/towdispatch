/**
 * EV Recovery (Session 48) — equipment-rule contract.
 *
 * The output of the pure engine `requiredEquipmentForEv`. Conservative by
 * design: an unknown EV resolves to flatbed-only (see SESSION_48_DECISIONS.md).
 * Most EVs cannot be flat-towed at all — rolling the drive wheels back-feeds
 * the motor and damages the drive unit — so `flatbedRequired` is the norm.
 */
import { z } from 'zod';

export const evEquipmentRulesSchema = z.object({
  // True when the vehicle must ride fully on a flatbed (no wheels turning).
  flatbedRequired: z.boolean(),
  // True when wheel-lift + dollies under the non-drive axle is acceptable.
  dolliesAllowed: z.boolean(),
  // True when a bare wheel-lift (drive wheels off the ground) is acceptable
  // for a short reposition only.
  wheelLiftAllowed: z.boolean(),
  // Hard cap on any wheels-down movement (miles). 0 = never roll the wheels.
  maxWheelDownMiles: z.number().int().min(0),
  // True when the HV system should be isolated before loading (post-incident
  // or damaged-pack situations).
  hvIsolationRequired: z.boolean(),
  reasons: z.array(z.string()),
});
export type EvEquipmentRules = z.infer<typeof evEquipmentRulesSchema>;
