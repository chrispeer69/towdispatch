/**
 * TierOfferRepository — the only place that talks Drizzle for the
 * tier-offer tables. Every method takes a tenant-scoped transaction
 * handle (`Tx`) so RLS is always in force: the caller obtains it from
 * TenantAwareDb.runInTenantContext(), and the repo never opens its own
 * connection. This keeps tenant isolation a structural guarantee rather
 * than a per-query discipline.
 *
 * Soft-delete is honored on every read (deletedAt IS NULL). Writes set
 * updatedAt explicitly because Drizzle's defaultNow() only fires on
 * INSERT (the DB also has a BEFORE UPDATE trigger as a backstop).
 */
import { Injectable } from '@nestjs/common';
import {
  type NewTierOffer,
  type NewTierOfferRecipient,
  type TierOffer,
  type TierOfferRecipient,
  tierOfferRecipients,
  tierOffers,
} from '@ustowdispatch/db';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-aware-db.service.js';

@Injectable()
export class TierOfferRepository {
  // ---------- tier_offers ----------

  async listOffers(tx: Tx): Promise<TierOffer[]> {
    return tx.query.tierOffers.findMany({
      where: isNull(tierOffers.deletedAt),
      orderBy: (t, { desc: d }) => [d(t.createdAt)],
    });
  }

  async findOffer(tx: Tx, offerId: string): Promise<TierOffer | undefined> {
    return tx.query.tierOffers.findFirst({
      where: and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)),
    });
  }

  async insertOffer(tx: Tx, values: NewTierOffer): Promise<TierOffer> {
    const [row] = await tx.insert(tierOffers).values(values).returning();
    if (!row) throw new Error('insertOffer: insert returning() yielded no row');
    return row;
  }

  async updateOffer(
    tx: Tx,
    offerId: string,
    patch: Partial<NewTierOffer>,
  ): Promise<TierOffer | undefined> {
    const [row] = await tx
      .update(tierOffers)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)))
      .returning();
    return row;
  }

  async softDeleteOffer(tx: Tx, offerId: string): Promise<void> {
    await tx
      .update(tierOffers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)));
  }

  // ---------- tier_offer_recipients ----------

  async listRecipientsForOffer(tx: Tx, offerId: string): Promise<TierOfferRecipient[]> {
    return tx.query.tierOfferRecipients.findMany({
      where: and(eq(tierOfferRecipients.offerId, offerId), isNull(tierOfferRecipients.deletedAt)),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });
  }

  async findRecipient(tx: Tx, recipientId: string): Promise<TierOfferRecipient | undefined> {
    return tx.query.tierOfferRecipients.findFirst({
      where: and(eq(tierOfferRecipients.id, recipientId), isNull(tierOfferRecipients.deletedAt)),
    });
  }

  async insertRecipient(tx: Tx, values: NewTierOfferRecipient): Promise<TierOfferRecipient> {
    const [row] = await tx.insert(tierOfferRecipients).values(values).returning();
    if (!row) throw new Error('insertRecipient: insert returning() yielded no row');
    return row;
  }

  async updateRecipient(
    tx: Tx,
    recipientId: string,
    patch: Partial<NewTierOfferRecipient>,
  ): Promise<TierOfferRecipient | undefined> {
    const [row] = await tx
      .update(tierOfferRecipients)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(tierOfferRecipients.id, recipientId), isNull(tierOfferRecipients.deletedAt)))
      .returning();
    return row;
  }

  /**
   * Cron-sweep target: recipients still in flight (sent/delivered/opened)
   * whose magic link TTL has elapsed. Matches the partial index
   * `tier_offer_recipients_tenant_expiry_active_idx` from Session 1.
   */
  async findExpirableRecipients(tx: Tx, now: Date): Promise<TierOfferRecipient[]> {
    return tx.query.tierOfferRecipients.findMany({
      where: and(
        inArray(tierOfferRecipients.status, ['sent', 'delivered', 'opened']),
        lte(tierOfferRecipients.magicLinkExpiresAt, now),
        isNull(tierOfferRecipients.deletedAt),
      ),
      orderBy: (t, { asc }) => [asc(t.magicLinkExpiresAt)],
    });
  }

  /** Count of active (non-deleted) recipients on an offer, by status set. */
  async listRecipientsForOfferByStatus(
    tx: Tx,
    offerId: string,
    statuses: TierOfferRecipient['status'][],
  ): Promise<TierOfferRecipient[]> {
    return tx.query.tierOfferRecipients.findMany({
      where: and(
        eq(tierOfferRecipients.offerId, offerId),
        inArray(tierOfferRecipients.status, statuses),
        isNull(tierOfferRecipients.deletedAt),
      ),
      orderBy: (t, { desc: d }) => [d(t.createdAt)],
    });
  }
}
