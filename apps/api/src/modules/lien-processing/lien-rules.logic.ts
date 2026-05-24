/**
 * Lien-sale rule engine (Lien Processing, Session 23) — PURE functions.
 *
 * Given the facts of a lien case + the per-state rule config + today, it
 * computes the single next operator action, when it is due, and whether the
 * case is blocked from proceeding to sale. It never mutates anything and
 * never decides to SELL — that is always an explicit operator action. The
 * service layer applies these results; the cron only reads them.
 *
 * Conservative posture: when the estimated value is unknown the case is
 * treated as the 'mid' tier (publication required); when the registered
 * owner could not be found, publication is required regardless of tier
 * (publication substitutes for personal notice). See SESSION_23_DECISIONS.md.
 */
import type {
  LienActionType,
  LienCaseStatus,
  LienCaseStep,
  LienState,
  LienStateRules,
  LienValueTier,
} from '@ustowdispatch/shared';

// All timestamps are UTC (the DB invariant), so day math uses UTC.
const DAY_MS = 86_400_000;

export function addUtcDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function maxDate(dates: (Date | null)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  }
  return best;
}

/**
 * Bucket an estimated value into low / mid / high. Unknown value defaults to
 * 'mid' — the conservative middle that keeps the publication requirement on.
 */
export function computeValueTier(
  estimatedValueCents: number | null | undefined,
  rules: LienStateRules,
): LienValueTier {
  if (estimatedValueCents === null || estimatedValueCents === undefined) return 'mid';
  if (estimatedValueCents <= rules.valueTiers.lowMaxCents) return 'low';
  if (estimatedValueCents >= rules.valueTiers.highMinCents) return 'high';
  return 'mid';
}

export interface LienCaseFacts {
  state: LienState;
  status: LienCaseStatus;
  currentStep: LienCaseStep;
  valueTier: LienValueTier;
  ownerFound: boolean;
  lienholderFound: boolean;
  openedAt: Date;
  dmvLookupCompletedAt: Date | null;
  ownerNoticeSentAt: Date | null;
  lienholderNoticeSentAt: Date | null;
  publicationCompletedAt: Date | null;
  ownerResponseAt: Date | null;
  lienholderResponseAt: Date | null;
}

export interface ComputedNextAction {
  action: LienActionType;
  dueAt: Date | null;
  blocking: boolean;
  reasons: string[];
}

/**
 * Whether newspaper publication is required for this case. Publication is
 * skipped for low-value vehicles in states that exempt them, but is always
 * required when the registered owner could not be located (publication
 * stands in for personal notice).
 */
export function isPublicationRequired(facts: LienCaseFacts, rules: LienStateRules): boolean {
  // States with no publication mechanism (e.g. TX, OH) rely on certified
  // notice + the waiting period even when the owner is unknown.
  if (!rules.publicationRequired) return false;
  // Owner could not be located → publication substitutes for personal notice.
  if (!facts.ownerFound) return true;
  // Low-value vehicles are exempt where the statute allows it.
  if (facts.valueTier === 'low' && rules.lowValuePublicationExempt) return false;
  return true;
}

/**
 * The earliest date a sale may legally proceed: the max of the minimum
 * holding period and every notice/publication waiting window that applies.
 */
export function computeEarliestSaleDate(facts: LienCaseFacts, rules: LienStateRules): Date {
  const candidates: (Date | null)[] = [addUtcDays(facts.openedAt, rules.minDaysToSale)];
  if (facts.ownerNoticeSentAt) {
    candidates.push(addUtcDays(facts.ownerNoticeSentAt, rules.ownerNoticeWaitDays));
  }
  if (facts.lienholderNoticeSentAt) {
    candidates.push(addUtcDays(facts.lienholderNoticeSentAt, rules.lienholderNoticeWaitDays));
  }
  if (isPublicationRequired(facts, rules) && facts.publicationCompletedAt) {
    candidates.push(addUtcDays(facts.publicationCompletedAt, rules.publicationWaitDays));
  }
  // minDaysToSale is always present, so maxDate cannot return null here.
  return maxDate(candidates) as Date;
}

/**
 * The core decision: what does the operator do next, by when, and is the
 * case blocked from sale? Returns exactly one recommended action.
 */
export function computeNextAction(
  facts: LienCaseFacts,
  rules: LienStateRules,
  today: Date,
): ComputedNextAction {
  // Terminal outcomes.
  if (facts.status === 'sold' || facts.status === 'closed' || facts.status === 'canceled') {
    return { action: 'none', dueAt: null, blocking: false, reasons: [] };
  }

  // A recorded response/claim halts the sale until the operator resolves it.
  if (facts.ownerResponseAt || facts.lienholderResponseAt) {
    return {
      action: 'resolve_claim',
      dueAt: null,
      blocking: true,
      reasons: ['A notice response/claim was recorded; resolve it before any sale.'],
    };
  }

  // Statutory prerequisites already satisfied.
  if (facts.status === 'ready_for_sale' || facts.currentStep === 'ready_for_sale') {
    return {
      action: 'conduct_sale',
      dueAt: null,
      blocking: false,
      reasons: ['Statutory prerequisites satisfied; the vehicle may be sold.'],
    };
  }

  const pubRequired = isPublicationRequired(facts, rules);

  switch (facts.currentStep) {
    case 'opened':
      return {
        action: 'request_dmv_lookup',
        dueAt: addUtcDays(facts.openedAt, rules.dmvLookupWindowDays),
        blocking: true,
        reasons: ['Request the DMV owner/lienholder lookup to identify notice recipients.'],
      };

    case 'dmv_lookup_requested':
      return {
        action: 'complete_dmv_lookup',
        dueAt: addUtcDays(facts.openedAt, rules.dmvLookupWindowDays),
        blocking: true,
        reasons: ['Record the DMV lookup result (owner / lienholder found).'],
      };

    case 'dmv_lookup_complete':
      return {
        action: 'send_owner_notice',
        dueAt: facts.dmvLookupCompletedAt ?? today,
        blocking: true,
        reasons: ['Send certified notice of pending lien sale to the registered owner.'],
      };

    case 'owner_notice_sent':
      if (facts.lienholderFound && !facts.lienholderNoticeSentAt) {
        return {
          action: 'send_lienholder_notice',
          dueAt: facts.ownerNoticeSentAt ?? today,
          blocking: true,
          reasons: ['Send certified notice to the recorded lienholder.'],
        };
      }
      if (pubRequired && !facts.publicationCompletedAt) {
        return {
          action: 'publish_notice',
          dueAt: facts.ownerNoticeSentAt ?? today,
          blocking: true,
          reasons: ['Publish the lien-sale notice in a newspaper of general circulation.'],
        };
      }
      return waitingAction(facts, rules, today);

    case 'lienholder_notice_sent':
      if (pubRequired && !facts.publicationCompletedAt) {
        return {
          action: 'publish_notice',
          dueAt: facts.lienholderNoticeSentAt ?? today,
          blocking: true,
          reasons: ['Publish the lien-sale notice in a newspaper of general circulation.'],
        };
      }
      return waitingAction(facts, rules, today);

    case 'publication_complete':
      return waitingAction(facts, rules, today);

    case 'waiting_period':
      return waitingAction(facts, rules, today);

    default:
      return { action: 'none', dueAt: null, blocking: false, reasons: [] };
  }
}

function waitingAction(
  facts: LienCaseFacts,
  rules: LienStateRules,
  today: Date,
): ComputedNextAction {
  const earliest = computeEarliestSaleDate(facts, rules);
  if (today.getTime() >= earliest.getTime()) {
    return {
      action: 'mark_ready_for_sale',
      dueAt: earliest,
      blocking: true,
      reasons: ['The statutory waiting period has elapsed; mark the case ready for sale.'],
    };
  }
  return {
    action: 'await_waiting_period',
    dueAt: earliest,
    blocking: true,
    reasons: [`The statutory waiting period ends ${earliest.toISOString().slice(0, 10)}.`],
  };
}
