/**
 * Lien Processing (Session 23) — lien timeline event contract.
 *
 * Mirrors the lien_timeline_events Drizzle schema. Append-only audit trail
 * of case activity; `payload` carries event-specific detail.
 */
import { z } from 'zod';

export const lienTimelineEventTypeValues = [
  'case_opened',
  'value_tier_set',
  'dmv_lookup_recorded',
  'notice_recorded',
  'response_recorded',
  'step_advanced',
  'action_due',
  'marked_ready_for_sale',
  'case_sold',
  'case_closed',
  'case_canceled',
] as const;
export type LienTimelineEventType = (typeof lienTimelineEventTypeValues)[number];

export const lienTimelineEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  lienCaseId: z.string().uuid(),
  eventType: z.enum(lienTimelineEventTypeValues),
  occurredAt: z.string().datetime(),
  actorUserId: z.string().uuid().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type LienTimelineEventDto = z.infer<typeof lienTimelineEventSchema>;
