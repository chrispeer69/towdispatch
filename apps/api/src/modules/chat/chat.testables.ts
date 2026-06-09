/**
 * chat.testables — pure helpers extracted so the unit tests can exercise the
 * wire-format mapping (kind ↔ attachment_type, sender ↔ author_role, cursor
 * codec, delivery-state derivation) without booting Nest or Postgres.
 *
 * Behavioral tests for the service (idempotency, participant gating, RLS
 * isolation) live in test/integration/chat.spec.ts.
 */
import type { ChatAttachmentType, ChatAuthorRole } from '@towdispatch/db';
import type { ChatDeliveryState, ChatMessageKind, ChatMessageSender } from '@towdispatch/shared';

export const ChatServiceTestables = {
  kindFromAttachment(attachmentType: ChatAttachmentType): ChatMessageKind {
    if (attachmentType === 'voice_memo') return 'voice';
    if (attachmentType === 'photo') return 'photo';
    if (attachmentType === 'video') return 'video';
    return 'text';
  },

  senderFromAuthorRole(role: ChatAuthorRole): ChatMessageSender {
    if (role === 'driver') return 'driver';
    return 'dispatcher';
  },

  deliveryStateFromRow(row: {
    readAt: Date | null;
    deliveredAt: Date | null;
  }): ChatDeliveryState {
    if (row.readAt) return 'read';
    if (row.deliveredAt) return 'delivered';
    return 'sent';
  },

  encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
  },

  decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
    try {
      const raw = Buffer.from(cursor, 'base64url').toString('utf8');
      const [iso, id] = raw.split('|');
      if (!iso || !id) return null;
      const createdAt = new Date(iso);
      if (Number.isNaN(createdAt.getTime())) return null;
      return { createdAt, id };
    } catch {
      return null;
    }
  },
};
