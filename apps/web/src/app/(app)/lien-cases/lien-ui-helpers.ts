/**
 * Pure presentation helpers for the lien-cases web views. Kept separate from
 * the client components so they can be unit-tested without a DOM.
 */
import type {
  LienActionType,
  LienCaseStatus,
  LienCaseStep,
  LienDeliveryMethod,
  LienNoticeType,
  LienRecipientRole,
} from '@ustowdispatch/shared';

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const STATUS_LABEL: Record<LienCaseStatus, string> = {
  open: 'Open',
  ready_for_sale: 'Ready for sale',
  sold: 'Sold',
  closed: 'Closed',
  canceled: 'Canceled',
};

export const STATUS_TONE: Record<LienCaseStatus, string> = {
  open: 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30',
  ready_for_sale:
    'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30',
  sold: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  closed: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  canceled: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark line-through',
};

export const STEP_LABEL: Record<LienCaseStep, string> = {
  opened: 'Opened',
  dmv_lookup_requested: 'DMV lookup requested',
  dmv_lookup_complete: 'DMV lookup complete',
  owner_notice_sent: 'Owner notice sent',
  lienholder_notice_sent: 'Lienholder notice sent',
  publication_complete: 'Publication complete',
  waiting_period: 'Waiting period',
  ready_for_sale: 'Ready for sale',
  sold: 'Sold',
  closed: 'Closed',
};

export const ACTION_LABEL: Record<LienActionType, string> = {
  request_dmv_lookup: 'Request DMV lookup',
  complete_dmv_lookup: 'Record DMV lookup result',
  send_owner_notice: 'Send owner notice',
  send_lienholder_notice: 'Send lienholder notice',
  publish_notice: 'Publish notice',
  await_waiting_period: 'Await waiting period',
  mark_ready_for_sale: 'Mark ready for sale',
  conduct_sale: 'Conduct sale',
  resolve_claim: 'Resolve claim',
  none: 'No action',
};

export const NOTICE_TYPE_LABEL: Record<LienNoticeType, string> = {
  owner_notice: 'Owner notice',
  lienholder_notice: 'Lienholder notice',
  publication_notice: 'Publication notice',
  dmv_request: 'DMV request',
};

export const RECIPIENT_ROLE_LABEL: Record<LienRecipientRole, string> = {
  owner: 'Registered owner',
  lienholder: 'Lienholder',
  dmv: 'DMV',
  public: 'Public (publication)',
};

export const DELIVERY_METHOD_LABEL: Record<LienDeliveryMethod, string> = {
  certified_mail: 'Certified mail',
  first_class_mail: 'First-class mail',
  publication: 'Publication',
  electronic: 'Electronic',
  in_person: 'In person',
};

/** Tone classes for a next-action due date, given blocking + overdue state. */
export function dueTone(dueAt: string | null, now: Date = new Date()): string {
  if (!dueAt) return 'text-text-secondary-on-dark';
  const due = new Date(dueAt).getTime();
  if (due <= now.getTime()) return 'text-status-warning font-semibold';
  const soon = now.getTime() + 3 * 86_400_000;
  if (due <= soon) return 'text-accent-orange';
  return 'text-text-secondary-on-dark';
}
