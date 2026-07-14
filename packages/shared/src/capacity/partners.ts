/**
 * CADS partner contracts — registered outbound consumers of the capacity
 * signal (Agero, AAA, NSD, GEICO, Urgently, or any generic webhook).
 * Credentials are shown exactly once at creation/rotation.
 */
import { z } from 'zod';
import {
  CAPACITY_DUTY_CLASSES,
  capacityDeliveryModeSchema,
  capacityDutyClassSchema,
  capacityNetworkCodeSchema,
} from './core';

const classVisibilitySchema = z
  .array(capacityDutyClassSchema)
  .min(1, 'Pick at least one duty class')
  .max(CAPACITY_DUTY_CLASSES.length)
  .refine((v) => new Set(v).size === v.length, 'Duplicate duty class');

export const capacityPartnerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  networkCode: capacityNetworkCodeSchema,
  deliveryMode: capacityDeliveryModeSchema,
  webhookUrl: z.string().nullable(),
  /** Set when a pull-API key exists; the key itself is never re-shown. */
  apiKeyPrefix: z.string().nullable(),
  enabled: z.boolean(),
  classVisibility: z.array(capacityDutyClassSchema),
  lastBroadcastAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type CapacityPartnerDto = z.infer<typeof capacityPartnerSchema>;

export const createCapacityPartnerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  networkCode: capacityNetworkCodeSchema.default('generic'),
  deliveryMode: capacityDeliveryModeSchema.default('webhook'),
  /** Required when deliveryMode is 'webhook'; must be a public https URL. */
  webhookUrl: z.string().url().max(2000).optional(),
  classVisibility: classVisibilitySchema.default([...CAPACITY_DUTY_CLASSES]),
});
export type CreateCapacityPartnerPayload = z.infer<typeof createCapacityPartnerSchema>;

export const updateCapacityPartnerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  networkCode: capacityNetworkCodeSchema.optional(),
  deliveryMode: capacityDeliveryModeSchema.optional(),
  webhookUrl: z.string().url().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
  classVisibility: classVisibilitySchema.optional(),
});
export type UpdateCapacityPartnerPayload = z.infer<typeof updateCapacityPartnerSchema>;

/**
 * Returned once at creation and by the rotate endpoints. webhookSecret
 * signs outbound payloads (partner verifies); apiKey authenticates the
 * partner's pull-API requests. Either may be null depending on delivery
 * mode.
 */
export const capacityPartnerCredentialsSchema = z.object({
  partner: capacityPartnerSchema,
  webhookSecret: z.string().nullable(),
  apiKey: z.string().nullable(),
});
export type CapacityPartnerCredentials = z.infer<typeof capacityPartnerCredentialsSchema>;

/** Result of the settings-page "test fire" action. */
export const capacityTestFireResultSchema = z.object({
  broadcastId: z.string().uuid(),
  delivered: z.boolean(),
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type CapacityTestFireResult = z.infer<typeof capacityTestFireResultSchema>;
