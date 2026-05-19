/**
 * SendGrid Event Webhook handler — Tier Offer Composer Session 4.
 *
 * SendGrid posts an array of event objects to our configured webhook
 * URL. Each event maps to a single email send; for tier-offer
 * invitations we put `recipientId`, `offerId`, and `tenantId` into
 * SendGrid's `customArgs` so the webhook can correlate without trusting
 * the magic-link token over the wire.
 *
 * State transitions (idempotent — never go backwards):
 *
 *   delivered  → status pending_send | sent       → delivered
 *   open       → status sent | delivered          → opened (and stamps
 *                  email_opened_at on first open)
 *   click      → no status transition; we already track click via the
 *                  public accept/decline endpoints which have richer
 *                  audit (IP, UA, response timestamp)
 *   bounce / dropped / deferred → status pending_send | sent | delivered
 *                  | opened                       → bounced
 *   unsubscribe → no transition (operator does not run a marketing
 *                  list; honored at the operations layer, not modeled
 *                  in v1)
 *
 * Idempotency: every UPDATE has an `IN (...)` source-status whitelist so
 * a duplicate delivered event after an accept does NOT regress the row.
 *
 * Errors per event are caught + logged; one bad event must never tank
 * the whole batch (SendGrid posts up to 1000 events per request).
 */
import { Injectable, Logger } from '@nestjs/common';
import { tierOfferRecipients } from '@ustowdispatch/db';
import { and, eq, inArray } from 'drizzle-orm';
import { TransactionRunner } from '../../database/transaction-runner.service.js';

/** Subset of SendGrid event-webhook payload keys we care about. */
export interface SendGridEvent {
  /** Event timestamp (unix seconds). */
  timestamp?: number;
  /** Event name — `delivered` | `open` | `click` | `bounce` | `dropped` | … */
  event: string;
  /** Recipient email. */
  email?: string;
  /** SendGrid message id (sg_message_id is the long form). */
  sg_message_id?: string;
  /** Custom args we attached at send time. */
  recipientId?: string;
  offerId?: string;
  tenantId?: string;
  /** Some events also carry kind so a single webhook URL can serve many features. */
  kind?: string;
}

export interface WebhookProcessingResult {
  total: number;
  applied: number;
  skipped: number;
  failed: number;
  notes: string[];
}

@Injectable()
export class TierOfferWebhookService {
  private readonly log = new Logger(TierOfferWebhookService.name);

  constructor(private readonly admin: TransactionRunner) {}

  async handleEvents(events: SendGridEvent[]): Promise<WebhookProcessingResult> {
    const result: WebhookProcessingResult = {
      total: events.length,
      applied: 0,
      skipped: 0,
      failed: 0,
      notes: [],
    };
    for (const ev of events) {
      try {
        const handled = await this.handleOne(ev);
        if (handled === 'applied') result.applied += 1;
        else result.skipped += 1;
      } catch (err) {
        result.failed += 1;
        this.log.error({
          msg: 'tier-offer webhook event failed',
          event: ev.event,
          recipientId: ev.recipientId,
          err: (err as Error).message,
        });
      }
    }
    return result;
  }

  private async handleOne(ev: SendGridEvent): Promise<'applied' | 'skipped'> {
    // Skip events that aren't ours. SendGrid sends a single webhook URL
    // for every send, so the same endpoint may see other features'
    // events later if they ever opt in.
    if (ev.kind && ev.kind !== 'tier-offer-invitation') return 'skipped';
    if (!ev.recipientId) return 'skipped';
    const eventName = ev.event?.toLowerCase();
    if (!eventName) return 'skipped';

    if (eventName === 'click' || eventName === 'unsubscribe') {
      // Soft signals; not modeled.
      return 'skipped';
    }

    return this.admin.runAsAdmin({}, async (db) => {
      if (eventName === 'delivered') {
        const [row] = await db
          .update(tierOfferRecipients)
          .set({
            emailDeliveredAt: ev.timestamp ? new Date(ev.timestamp * 1000) : new Date(),
            status: 'delivered',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tierOfferRecipients.id, ev.recipientId as string),
              inArray(tierOfferRecipients.status, ['pending_send', 'sent']),
            ),
          )
          .returning();
        return row ? 'applied' : 'skipped';
      }
      if (eventName === 'open') {
        const [row] = await db
          .update(tierOfferRecipients)
          .set({
            emailOpenedAt: ev.timestamp ? new Date(ev.timestamp * 1000) : new Date(),
            status: 'opened',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tierOfferRecipients.id, ev.recipientId as string),
              inArray(tierOfferRecipients.status, ['sent', 'delivered']),
            ),
          )
          .returning();
        return row ? 'applied' : 'skipped';
      }
      if (eventName === 'bounce' || eventName === 'dropped' || eventName === 'deferred') {
        const [row] = await db
          .update(tierOfferRecipients)
          .set({ status: 'bounced', updatedAt: new Date() })
          .where(
            and(
              eq(tierOfferRecipients.id, ev.recipientId as string),
              inArray(tierOfferRecipients.status, ['pending_send', 'sent', 'delivered', 'opened']),
            ),
          )
          .returning();
        return row ? 'applied' : 'skipped';
      }
      // Other events (group_unsubscribe, group_resubscribe, spamreport,
      // processed) — log only.
      return 'skipped';
    });
  }
}
