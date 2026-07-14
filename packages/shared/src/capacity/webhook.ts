/**
 * CADS partner-facing payload — the machine-readable availability signal.
 * Shared verbatim by the outbound webhook POST body and the pull API
 * (GET /v1/capacity) response, so partner integrations parse one shape.
 *
 * External contract: snake_case keys, schema_version pinned at "1.0".
 * Adding fields is allowed; renaming/removing is a schema_version bump.
 *
 * Webhook deliveries are signed: X-TowCommand-Signature: t=<unix>,v1=<hex>
 * where v1 = HMAC-SHA256(secret, `${t}.${rawBody}`) — identical scheme to
 * the public-api webhooks so partners verify all our webhooks one way.
 * X-TowCommand-Delivery-Id carries a unique nonce per delivery for replay
 * protection alongside the signed timestamp (300s tolerance).
 */
import { z } from 'zod';
import { CAPACITY_SCHEMA_VERSION, capacityBandSchema } from './core';

export const capacityPayloadClassSchema = z.object({
  status: capacityBandSchema,
  /** null when the class is offline (no eligible drivers). */
  ratio: z.number().min(0).nullable(),
  drivers: z.number().int().min(0),
  active_jobs: z.number().min(0),
});
export type CapacityPayloadClass = z.infer<typeof capacityPayloadClassSchema>;

export const capacityPayloadSchema = z.object({
  schema_version: z.literal(CAPACITY_SCHEMA_VERSION),
  /** Tenant identity: stable id plus the human-readable company name. */
  tenant_id: z.string().uuid(),
  tenant_name: z.string(),
  timestamp: z.string().datetime(),
  /** Contractual max-response guideline the bands are calibrated against. */
  guideline_minutes: z.number().int().positive(),
  /** True when any visible class is under a manual override (no reason exposed). */
  override_active: z.boolean(),
  /** Keyed by duty class; filtered to the partner's class visibility. */
  classes: z.record(z.string(), capacityPayloadClassSchema),
  blended: capacityPayloadClassSchema,
});
export type CapacityPayload = z.infer<typeof capacityPayloadSchema>;

/** Pull-API history row (bounded, paginated). */
export const capacityHistoryEntrySchema = z.object({
  duty_class: z.string(),
  status: capacityBandSchema,
  ratio: z.number().min(0).nullable(),
  drivers: z.number().int().min(0),
  active_jobs: z.number().min(0),
  override_active: z.boolean(),
  computed_at: z.string().datetime(),
});
export type CapacityHistoryEntry = z.infer<typeof capacityHistoryEntrySchema>;

export const capacityHistoryResponseSchema = z.object({
  schema_version: z.literal(CAPACITY_SCHEMA_VERSION),
  tenant_id: z.string().uuid(),
  hours: z.number().int().positive(),
  page: z.number().int().min(1),
  per_page: z.number().int().min(1),
  total: z.number().int().min(0),
  entries: z.array(capacityHistoryEntrySchema),
});
export type CapacityHistoryResponse = z.infer<typeof capacityHistoryResponseSchema>;
