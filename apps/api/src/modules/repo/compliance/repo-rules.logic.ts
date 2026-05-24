/**
 * Repossession-compliance rule engine (Repo Compliance, Session 50) — PURE
 * functions. They never mutate anything, never touch the DB, and never decide
 * to DISPOSE of a vehicle — disposition is always an explicit operator action.
 *
 * Three entry points (the Session 50 deliverable):
 *   - computeNextRepoAction(facts, rules, today) → the single next operator
 *     action, when it is due, whether the case is blocked, the statute cite.
 *   - validatePeacefulRepo(attempt, rules) → whether a recovery attempt was a
 *     lawful self-help repo or a breach of the peace (UCC §9-609), + reasons.
 *   - computePersonalPropertyHold(recoveredAt, rules) → how long personal
 *     property left in the vehicle must be held and how it is released.
 *
 * Conservative posture (see SESSION_50_DECISIONS.md): on the debtor's objection
 * at the scene the right to proceed ends; ambiguous statutes get the longer
 * hold. Where a state grants only a post-sale right, redemptionPeriodDays is 0.
 */
import type {
  RepoActionType,
  RepoAttemptFacts,
  RepoCaseFacts,
  RepoCaseStatus,
  RepoCaseStep,
  RepoPeacefulResult,
  RepoPersonalPropertyHoldResult,
  RepoStateRules,
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

export interface ComputedRepoAction {
  action: RepoActionType;
  dueAt: Date | null;
  blocking: boolean;
  statuteCitation: string;
  reasons: string[];
}

const TERMINAL_STATUSES: ReadonlySet<RepoCaseStatus> = new Set<RepoCaseStatus>([
  'redeemed',
  'disposed',
  'closed',
  'canceled',
]);

/**
 * The earliest date the lender may legally dispose of the vehicle: the max of
 * every statutory waiting window that applies (post-repo notice period and the
 * redemption window, both measured from recovery).
 */
export function computeEarliestDispositionDate(
  facts: RepoCaseFacts,
  rules: RepoStateRules,
  recoveredAt: Date,
): Date {
  const candidates: (Date | null)[] = [recoveredAt];
  if (rules.redemptionPeriodDays > 0) {
    candidates.push(addUtcDays(recoveredAt, rules.redemptionPeriodDays));
  }
  if (rules.postRepoNoticeRequired && facts.postRepoNoticeSentAt) {
    // The disposition cannot occur until the redemption window stated in the
    // post-repo notice has run; use the longer of notice+redemption.
    // facts.postRepoNoticeSentAt crosses the wire as an ISO string.
    candidates.push(addUtcDays(new Date(facts.postRepoNoticeSentAt), rules.redemptionPeriodDays));
  }
  return maxDate(candidates) as Date;
}

/**
 * The core decision: what does the operator do next, by when, and is the case
 * blocked from disposition? Returns exactly one recommended action.
 */
export function computeNextRepoAction(
  facts: RepoCaseFacts,
  rules: RepoStateRules,
  today: Date,
): ComputedRepoAction {
  const cite = rules.statute;

  // Terminal outcomes.
  if (TERMINAL_STATUSES.has(facts.status)) {
    return { action: 'none', dueAt: null, blocking: false, statuteCitation: cite, reasons: [] };
  }

  // A flagged breach of the peace halts everything until the operator resolves
  // it (re-attempt lawfully or document the cure).
  if (facts.breachOfPeaceFlagged) {
    return {
      action: 'resolve_breach_flag',
      dueAt: null,
      blocking: true,
      statuteCitation: cite,
      reasons: [
        'A breach-of-peace violation was flagged on the recovery attempt; resolve it before proceeding (UCC §9-609).',
      ],
    };
  }

  // A recorded debtor response (redemption tender / dispute) halts disposition
  // until the operator resolves it.
  if (facts.debtorResponseAt) {
    return {
      action: 'resolve_debtor_response',
      dueAt: null,
      blocking: true,
      statuteCitation: cite,
      reasons: ['A debtor response/claim was recorded; resolve it before any disposition.'],
    };
  }

  const parsedOpenedAt = new Date(facts.openedAt);
  const recoveredAt = facts.recoveredAt ? new Date(facts.recoveredAt) : null;
  const preRepoSentAt = facts.preRepoNoticeSentAt ? new Date(facts.preRepoNoticeSentAt) : null;

  switch (facts.currentStep) {
    case 'opened':
      if (rules.preRepoNoticeRequired) {
        return {
          action: 'send_pre_repo_notice',
          dueAt: parsedOpenedAt,
          blocking: true,
          statuteCitation: cite,
          reasons: [
            `This state requires a pre-repossession notice / right-to-cure (${rules.preRepoNoticeDays} days) before recovery.`,
          ],
        };
      }
      return {
        action: 'record_recovery',
        dueAt: null,
        blocking: true,
        statuteCitation: cite,
        reasons: ['Recover the vehicle (peaceful repo) and record the recovery.'],
      };

    case 'pre_repo_notice_sent': {
      const cureEnds = preRepoSentAt
        ? addUtcDays(preRepoSentAt, rules.preRepoNoticeDays)
        : parsedOpenedAt;
      if (today.getTime() < cureEnds.getTime()) {
        return {
          action: 'await_pre_repo_cure_period',
          dueAt: cureEnds,
          blocking: true,
          statuteCitation: cite,
          reasons: [`The pre-repossession cure period ends ${isoDay(cureEnds)}.`],
        };
      }
      return {
        action: 'record_recovery',
        dueAt: cureEnds,
        blocking: true,
        statuteCitation: cite,
        reasons: ['The cure period has elapsed; recover the vehicle and record the recovery.'],
      };
    }

    case 'recovered': {
      if (rules.postRepoNoticeRequired && !facts.postRepoNoticeSentAt) {
        return {
          action: 'send_post_repo_notice',
          dueAt: recoveredAt ? addUtcDays(recoveredAt, rules.postRepoNoticeDays) : today,
          blocking: true,
          statuteCitation: cite,
          reasons: [
            `Send the post-repossession notice of sale / right to redeem within ${rules.postRepoNoticeDays} days, by ${rules.postRepoNoticeMethod}.`,
          ],
        };
      }
      return sheriffOrRedemption(facts, rules, today, recoveredAt ?? parsedOpenedAt, cite);
    }

    case 'post_repo_notice_sent':
      return sheriffOrRedemption(facts, rules, today, recoveredAt ?? parsedOpenedAt, cite);

    case 'redemption_period':
      return redemptionGate(facts, rules, today, recoveredAt ?? parsedOpenedAt, cite);

    case 'ready_for_disposition':
      return {
        action: 'none',
        dueAt: null,
        blocking: false,
        statuteCitation: cite,
        reasons: ['Statutory prerequisites satisfied; the vehicle may be disposed of.'],
      };

    default:
      return { action: 'none', dueAt: null, blocking: false, statuteCitation: cite, reasons: [] };
  }
}

function sheriffOrRedemption(
  facts: RepoCaseFacts,
  rules: RepoStateRules,
  today: Date,
  recoveredAt: Date,
  cite: string,
): ComputedRepoAction {
  if (rules.sheriffNoticeRequired && !facts.sheriffNoticeSentAt) {
    return {
      action: 'notify_sheriff',
      dueAt: recoveredAt,
      blocking: true,
      statuteCitation: cite,
      reasons: [
        `Report the repossession to ${rules.sheriffNoticeJurisdiction ?? 'law enforcement'} to clear stolen-vehicle reports.`,
      ],
    };
  }
  if (rules.secondaryContactRequired && !facts.secondaryContactNotifiedAt) {
    return {
      action: 'notify_secondary_contact',
      dueAt: recoveredAt,
      blocking: true,
      statuteCitation: cite,
      reasons: ['Notify the secondary contact / co-buyer of the repossession.'],
    };
  }
  return redemptionGate(facts, rules, today, recoveredAt, cite);
}

function redemptionGate(
  facts: RepoCaseFacts,
  rules: RepoStateRules,
  today: Date,
  recoveredAt: Date,
  cite: string,
): ComputedRepoAction {
  const earliest = computeEarliestDispositionDate(facts, rules, recoveredAt);
  if (today.getTime() >= earliest.getTime()) {
    return {
      action: 'ready_for_disposition',
      dueAt: earliest,
      blocking: false,
      statuteCitation: cite,
      reasons:
        rules.redemptionPeriodDays > 0
          ? ['The statutory redemption period has elapsed; the vehicle may be disposed of.']
          : ['No pre-sale redemption window applies; the vehicle may be disposed of after notice.'],
    };
  }
  return {
    action: 'await_redemption_period',
    dueAt: earliest,
    blocking: true,
    statuteCitation: cite,
    reasons: [`The statutory redemption period ends ${isoDay(earliest)}.`],
  };
}

/**
 * Whether a recovery attempt was a lawful self-help repossession or a breach
 * of the peace (UCC §9-609). The core conditions are UCC-uniform; per-state
 * escalations (nightRepoIsBreach, presenceObjectionStrict) come from the rule
 * config. `allowed` is true only when no violation applies.
 */
export function validatePeacefulRepo(
  attempt: RepoAttemptFacts,
  rules: RepoStateRules,
): RepoPeacefulResult {
  const violations: string[] = [];

  if (attempt.usedOrThreatenedForce) {
    violations.push('Use or threat of physical force is a breach of the peace.');
  }
  if (attempt.enteredResidence) {
    violations.push(
      'Entering a residence (or an attached/closed garage) is a breach of the peace.',
    );
  }
  if (attempt.breachedLockedEnclosure) {
    violations.push(
      'Breaking into or opening a closed/locked enclosure (cutting a lock, opening a gate) is a breach of the peace.',
    );
  }
  if (attempt.lawEnforcementDirected) {
    violations.push(
      'An officer actively directing or assisting the repossession converts it to state action — a breach of the peace.',
    );
  }
  if (attempt.debtorObjected && rules.presenceObjectionStrict) {
    violations.push(
      'The debtor objected at the scene; continuing after a clear objection is a breach of the peace.',
    );
  }
  if (attempt.occurredAtNight && rules.nightRepoIsBreach) {
    violations.push('A nighttime repossession is treated as a breach of the peace in this state.');
  }

  return { allowed: violations.length === 0, violations, statuteCitation: rules.statute };
}

/**
 * How long personal property left in the recovered vehicle must be held, and
 * how it is released. Hold runs from the recovery date.
 */
export function computePersonalPropertyHold(
  recoveredAt: Date,
  rules: RepoStateRules,
): RepoPersonalPropertyHoldResult {
  const holdUntil = addUtcDays(recoveredAt, rules.personalPropertyHoldDays);
  return {
    holdUntil: holdUntil.toISOString(),
    holdDays: rules.personalPropertyHoldDays,
    releaseMethod: rules.personalPropertyReleaseMethod,
    statuteCitation: rules.statute,
  };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Forward-only ordering of the workflow steps. Used by the service to advance
// a case without ever regressing it.
export const REPO_STEP_RANK: Record<RepoCaseStep, number> = {
  opened: 0,
  pre_repo_notice_sent: 1,
  recovered: 2,
  post_repo_notice_sent: 3,
  redemption_period: 4,
  ready_for_disposition: 5,
};
