/**
 * CADS broadcast receipt contracts — every outbound delivery attempt is
 * recorded so "you said you were available" disputes can be settled from
 * the log.
 */
import { z } from 'zod';
import { capacityBroadcastStatusSchema } from './core';

export const capacityBroadcastSchema = z.object({
  id: z.string().uuid(),
  partnerId: z.string().uuid(),
  partnerName: z.string(),
  status: capacityBroadcastStatusSchema,
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  retryCount: z.number().int().min(0),
  nextRetryAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  payload: z.unknown(),
  createdAt: z.string().datetime(),
});
export type CapacityBroadcastDto = z.infer<typeof capacityBroadcastSchema>;

export const listCapacityBroadcastsQuerySchema = z.object({
  partnerId: z.string().uuid().optional(),
  status: capacityBroadcastStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCapacityBroadcastsQuery = z.infer<typeof listCapacityBroadcastsQuerySchema>;

export const capacityBroadcastPageSchema = z.object({
  items: z.array(capacityBroadcastSchema),
  page: z.number().int().min(1),
  perPage: z.number().int().min(1),
  total: z.number().int().min(0),
});
export type CapacityBroadcastPage = z.infer<typeof capacityBroadcastPageSchema>;
