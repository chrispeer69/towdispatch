/**
 * Row → DTO mappers. Drizzle hands back Date objects for timestamptz
 * columns; the shared Zod contracts type every timestamp as an ISO-8601
 * string, so we serialize at this boundary and keep Date out of shared
 * client code.
 */
import type { TierOffer, TierOfferRecipient } from '@ustowdispatch/db';
import type { TierOfferDto, TierOfferRecipientDto } from '@ustowdispatch/shared';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toTierOfferDto(row: TierOffer): TierOfferDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tierId: row.tierId,
    composedBy: row.composedBy,
    title: row.title,
    subjectLine: row.subjectLine,
    narrative: row.narrative,
    eventWindowStart: row.eventWindowStart.toISOString(),
    eventWindowEnd: row.eventWindowEnd.toISOString(),
    committedTruckCount: row.committedTruckCount,
    acceptanceDeadlineAt: row.acceptanceDeadlineAt.toISOString(),
    defaultForNonResponders: row.defaultForNonResponders,
    status: row.status,
    sentAt: iso(row.sentAt),
    cancelledAt: iso(row.cancelledAt),
    cancelledReason: row.cancelledReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
  };
}

export function toTierOfferRecipientDto(row: TierOfferRecipient): TierOfferRecipientDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    offerId: row.offerId,
    accountId: row.accountId,
    recipientName: row.recipientName,
    recipientRole: row.recipientRole,
    recipientEmail: row.recipientEmail,
    recipientPhone: row.recipientPhone,
    magicLinkToken: row.magicLinkToken,
    magicLinkExpiresAt: row.magicLinkExpiresAt.toISOString(),
    status: row.status,
    emailSentAt: iso(row.emailSentAt),
    emailDeliveredAt: iso(row.emailDeliveredAt),
    emailOpenedAt: iso(row.emailOpenedAt),
    respondedAt: iso(row.respondedAt),
    responseIp: row.responseIp,
    responseUserAgent: row.responseUserAgent,
    declineReason: row.declineReason,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
  };
}
