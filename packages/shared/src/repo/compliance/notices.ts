/**
 * Repo Compliance (Session 50) — required-notice contracts.
 *
 * Mirrors the repo_required_notices Drizzle schema. A case carries at most one
 * *pending* (unanswered) notice per (notice_type, recipient_role) — the
 * partial unique index in the migration; the service surfaces the violation as
 * a conflict.
 *
 * NOTE (S49 deferral): notices reference `repoCaseId` but there is no FK to a
 * repo_cases table yet (S49 is not on master). Each notice therefore carries
 * its own `state` so the engine / cron / PDF renderer can resolve per-state
 * rules without the parent case. See SESSION_50_DECISIONS.md (D0).
 */
import { z } from 'zod';
import { repoDeliveryMethodValues, repoRecipientRoleValues, repoStateValues } from './state-rules';

export const repoNoticeTypeValues = [
  'pre_repo_notice',
  'post_repo_notice',
  'personal_property_notice',
  'redemption_notice',
  'sheriff_notice',
] as const;
export type RepoNoticeType = (typeof repoNoticeTypeValues)[number];

export const repoRequiredNoticeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  repoCaseId: z.string().uuid(),
  state: z.string(),
  noticeType: z.enum(repoNoticeTypeValues),
  recipientRole: z.enum(repoRecipientRoleValues),
  recipientName: z.string().nullable(),
  recipientAddress: z.string().nullable(),
  statuteCitation: z.string(),
  deliveryMethod: z.enum(repoDeliveryMethodValues),
  certifiedTrackingNo: z.string().nullable(),
  sentAt: z.string().datetime(),
  responseDueAt: z.string().datetime().nullable(),
  responseReceivedAt: z.string().datetime().nullable(),
  responseNotes: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type RepoRequiredNoticeDto = z.infer<typeof repoRequiredNoticeSchema>;

export const recordRepoNoticeSchema = z
  .object({
    repoCaseId: z.string().uuid(),
    state: z.enum(repoStateValues),
    noticeType: z.enum(repoNoticeTypeValues),
    recipientRole: z.enum(repoRecipientRoleValues),
    recipientName: z.string().max(300).optional(),
    recipientAddress: z.string().max(2000).optional(),
    deliveryMethod: z.enum(repoDeliveryMethodValues),
    sentAt: z.string().datetime().optional(),
    certifiedTrackingNo: z.string().max(200).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type RecordRepoNoticePayload = z.infer<typeof recordRepoNoticeSchema>;

export const recordRepoNoticeResponseSchema = z
  .object({
    responseReceivedAt: z.string().datetime().optional(),
    responseNotes: z.string().max(5000).optional(),
  })
  .strict();
export type RecordRepoNoticeResponsePayload = z.infer<typeof recordRepoNoticeResponseSchema>;

export const listRepoNoticesFilterSchema = z
  .object({
    repoCaseId: z.string().uuid().optional(),
    state: z.enum(repoStateValues).optional(),
    noticeType: z.enum(repoNoticeTypeValues).optional(),
    // 'true' restricts to pending notices whose response_due_at is now-or-past.
    overdue: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListRepoNoticesFilter = z.infer<typeof listRepoNoticesFilterSchema>;
