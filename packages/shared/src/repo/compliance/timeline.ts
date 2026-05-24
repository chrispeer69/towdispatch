/**
 * Repo Compliance (Session 50) — timeline event contract.
 *
 * Mirrors the repo_timeline_events Drizzle schema. Append-only audit trail of
 * compliance activity for a repo case; `payload` carries event-specific
 * detail. `repoCaseId` has no FK yet (S49 deferral — see SESSION_50_DECISIONS).
 */
import { z } from 'zod';

export const repoTimelineEventTypeValues = [
  'notice_recorded',
  'notice_response_recorded',
  'notice_overdue',
  'breach_of_peace_flagged',
  'redemption_computed',
  'personal_property_hold_computed',
] as const;
export type RepoTimelineEventType = (typeof repoTimelineEventTypeValues)[number];

export const repoTimelineEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  repoCaseId: z.string().uuid(),
  eventType: z.enum(repoTimelineEventTypeValues),
  occurredAt: z.string().datetime(),
  actorUserId: z.string().uuid().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type RepoTimelineEventDto = z.infer<typeof repoTimelineEventSchema>;
