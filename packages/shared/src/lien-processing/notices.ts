/**
 * Lien Processing (Session 23) — lien notice contracts.
 *
 * Mirrors the lien_notices Drizzle schema. A case carries at most one
 * *pending* (unanswered) notice per (notice_type, recipient_role); the
 * service surfaces the partial-unique-index violation as a conflict.
 */
import { z } from 'zod';

// ----------------------------------------------------------------------
// Enums (mirror the DB CHECK constraints)
// ----------------------------------------------------------------------

export const lienNoticeTypeValues = [
  'owner_notice',
  'lienholder_notice',
  'publication_notice',
  'dmv_request',
] as const;
export type LienNoticeType = (typeof lienNoticeTypeValues)[number];

export const lienRecipientRoleValues = ['owner', 'lienholder', 'dmv', 'public'] as const;
export type LienRecipientRole = (typeof lienRecipientRoleValues)[number];

export const lienDeliveryMethodValues = [
  'certified_mail',
  'first_class_mail',
  'publication',
  'electronic',
  'in_person',
] as const;
export type LienDeliveryMethod = (typeof lienDeliveryMethodValues)[number];

// ----------------------------------------------------------------------
// DTO
// ----------------------------------------------------------------------

export const lienNoticeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  lienCaseId: z.string().uuid(),
  noticeType: z.enum(lienNoticeTypeValues),
  recipientRole: z.enum(lienRecipientRoleValues),
  recipientName: z.string().nullable(),
  recipientAddress: z.string().nullable(),
  deliveryMethod: z.enum(lienDeliveryMethodValues),
  sentAt: z.string().datetime(),
  certifiedTrackingNo: z.string().nullable(),
  responseReceivedAt: z.string().datetime().nullable(),
  responseNotes: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type LienNoticeDto = z.infer<typeof lienNoticeSchema>;

// ----------------------------------------------------------------------
// Payloads
// ----------------------------------------------------------------------

export const recordLienNoticeSchema = z
  .object({
    noticeType: z.enum(lienNoticeTypeValues),
    recipientRole: z.enum(lienRecipientRoleValues),
    recipientName: z.string().max(300).optional(),
    recipientAddress: z.string().max(2000).optional(),
    deliveryMethod: z.enum(lienDeliveryMethodValues),
    sentAt: z.string().datetime().optional(),
    certifiedTrackingNo: z.string().max(200).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type RecordLienNoticePayload = z.infer<typeof recordLienNoticeSchema>;

export const recordLienResponseSchema = z
  .object({
    responseReceivedAt: z.string().datetime().optional(),
    responseNotes: z.string().max(5000).optional(),
  })
  .strict();
export type RecordLienResponsePayload = z.infer<typeof recordLienResponseSchema>;
