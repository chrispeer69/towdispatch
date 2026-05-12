/**
 * Chat contract schemas — driver↔dispatcher messaging per job (Session 6.2).
 *
 * The wire format mirrors the iOS ChatMessage model exactly so the iOS app
 * can decode responses with zero translation. Internally the backend uses
 * `attachmentType` ∈ {none, voice_memo, photo, video}; the response maps
 * that to iOS's `kind` ∈ {text, voice, photo, video, quick_reply}. Sender
 * is folded from author_role: driver→driver, dispatcher/admin/manager→
 * dispatcher (system messages have no author role and are not emitted here).
 */
import { z } from 'zod';

export const chatMessageKindValues = ['text', 'voice', 'photo', 'video', 'quick_reply'] as const;
export type ChatMessageKind = (typeof chatMessageKindValues)[number];

export const chatMessageSenderValues = ['driver', 'dispatcher', 'system'] as const;
export type ChatMessageSender = (typeof chatMessageSenderValues)[number];

export const chatDeliveryStateValues = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export type ChatDeliveryState = (typeof chatDeliveryStateValues)[number];

/**
 * Wire shape returned to iOS. Field names match iOS `ChatMessage` exactly.
 * `id` here is the backend-assigned uuid; `clientMessageId` (omitted in the
 * response) was the iOS outbox id that drove idempotency.
 */
export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  sender: z.enum(chatMessageSenderValues),
  kind: z.enum(chatMessageKindValues),
  body: z.string().nullable(),
  attachmentUrl: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
  deliveryState: z.enum(chatDeliveryStateValues),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

/** Inbound message create — matches iOS SendChatMessageRequest. */
export const sendChatMessageSchema = z.object({
  clientMessageId: z.string().min(1).max(120),
  jobId: z.string().uuid(),
  kind: z.enum(chatMessageKindValues),
  body: z.string().max(4000).nullish(),
  attachmentUrl: z.string().min(1).max(2000).nullish(),
  durationSeconds: z
    .number()
    .int()
    .nonnegative()
    .max(60 * 60)
    .nullish(),
});
export type SendChatMessagePayload = z.infer<typeof sendChatMessageSchema>;

export const listChatMessagesQuerySchema = z.object({
  /** Opaque cursor returned by the previous page; null for the first page. */
  cursor: z.string().min(1).max(200).optional(),
  /** Page size. Defaults to 50, capped at 200. */
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListChatMessagesQuery = z.infer<typeof listChatMessagesQuerySchema>;

export const listChatMessagesResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
  nextCursor: z.string().nullable(),
});
export type ListChatMessagesResponse = z.infer<typeof listChatMessagesResponseSchema>;

export const attachmentUploadKindValues = ['voice_memo', 'photo', 'video'] as const;
export type AttachmentUploadKind = (typeof attachmentUploadKindValues)[number];

export const attachmentUrlRequestSchema = z.object({
  kind: z.enum(attachmentUploadKindValues),
  mimeType: z.string().min(1).max(160),
  /** Size hint (bytes). Used to short-circuit obviously-too-large uploads. */
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(1024 * 1024 * 50)
    .optional(),
});
export type AttachmentUrlRequestPayload = z.infer<typeof attachmentUrlRequestSchema>;

export const attachmentUrlResponseSchema = z.object({
  uploadUrl: z.string().min(1),
  /** Final URL the iOS app should send back as ChatMessage.attachmentUrl. */
  attachmentUrl: z.string().min(1),
  /** ISO timestamp; iOS should reject the URL after this and request a new one. */
  expiresAt: z.string().datetime(),
});
export type AttachmentUrlResponse = z.infer<typeof attachmentUrlResponseSchema>;
