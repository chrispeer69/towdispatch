/**
 * Repossession compliance rule engine (Repo Compliance, Session 51) — PURE
 * functions.
 *
 * Given the facts of a repossession case + the per-state rule config + today,
 * it computes the single next operator action, when it is due, and whether the
 * case is blocked from proceeding to disposition. It never mutates anything
 * and never decides to DISPOSE — that is always an explicit operator action.
 *
 * The persistence/state-machine layer (a RepoCaseService) was scoped to
 * Session 49 and is intentionally NOT built here — this engine operates over a
 * plain RepoCaseFacts struct, mirroring the lien rule engine's pure-function
 * design (see SESSION_51_DECISIONS.md).
 *
 * Conservative posture: when the estimated value is unknown the case is
 * treated as the 'mid' tier; a deficiency notice is only recommended for
 * mid/high-value collateral (pursuing a deficiency on low-value collateral is
 * rarely worthwhile — a product heuristic, not a statutory rule).
 */
import type {
  RepoActionType,
  RepoCaseStatus,
  RepoCaseStep,
  RepoState,
  RepoStateRules,
  RepoValueTier,
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
 * 'mid' — the conservative middle (deficiency notice still recommended).
 */
export function computeValueTier(
  estimatedValueCents: number | null | undefined,
  rules: RepoStateRules,
): RepoValueTier {
  if (estimatedValueCents === null || estimatedValueCents === undefined) return 'mid';
  if (estimatedValueCents <= rules.valueTiers.lowMaxCents) return 'low';
  if (estimatedValueCents >= rules.valueTiers.highMinCents) return 'high';
  return 'mid';
}

export interface RepoCaseFacts {
  state: RepoState;
  status: RepoCaseStatus;
  currentStep: RepoCaseStep;
  valueTier: RepoValueTier;
  openedAt: Date;
  // Pre-repossession Notice of Default + Right to Cure (cure states only).
  defaultNoticeSentAt: Date | null;
  // Date the vehicle was actually recovered (must have been a peaceful repo).
  repossessedAt: Date | null;
  // Personal property recovered from the vehicle inventoried + secured.
  personalPropertySecuredAt: Date | null;
  // Post-repossession Notice of Intent to dispose (UCC 9-611/9-614) sent.
  postRepoNoticeSentAt: Date | null;
  // A debtor dispute / claim (wrongful repo, bankruptcy stay, payoff dispute)
  // halts disposition until the operator resolves it.
  debtorResponseAt: Date | null;
}

export interface ComputedNextAction {
  action: RepoActionType;
  dueAt: Date | null;
  blocking: boolean;
  reasons: string[];
}

/**
 * Whether a pre-repossession right-to-cure notice gates the repossession for
 * this case. True only in cure states that have not yet sent the notice or
 * whose cure period has not elapsed.
 */
export function isPreRepoCurePending(
  facts: RepoCaseFacts,
  rules: RepoStateRules,
  today: Date,
): boolean {
  if (!rules.preRepoNoticeRequired) return false;
  if (!facts.defaultNoticeSentAt) return true;
  const cureEnds = addUtcDays(facts.defaultNoticeSentAt, rules.preRepoNoticeDays);
  return today.getTime() < cureEnds.getTime();
}

/**
 * The earliest date a disposition (sale/auction) may legally proceed: the max
 * of the redemption window (from repossession) and the post-repossession
 * notice lead window (from when the NOI was sent). Both must be recorded for
 * a finite date; an un-sent notice yields a far-future sentinel so the case
 * stays in the waiting state until the notice is recorded.
 */
export function computeEarliestDispositionDate(facts: RepoCaseFacts, rules: RepoStateRules): Date {
  const candidates: (Date | null)[] = [];
  if (facts.repossessedAt) {
    candidates.push(addUtcDays(facts.repossessedAt, rules.redemptionDays));
  }
  if (facts.postRepoNoticeSentAt) {
    candidates.push(addUtcDays(facts.postRepoNoticeSentAt, rules.postRepoNoticeDays));
  }
  const earliest = maxDate(candidates);
  // No repossession recorded yet → not computable; return a far-future date so
  // callers treat the case as not-yet-dispositionable.
  return earliest ?? addUtcDays(facts.openedAt, 36_500);
}

/**
 * The core decision: what does the operator do next, by when, and is the case
 * blocked from disposition? Returns exactly one recommended action.
 */
export function computeNextAction(
  facts: RepoCaseFacts,
  rules: RepoStateRules,
  today: Date,
): ComputedNextAction {
  // Terminal outcomes (except disposed, which may still need a deficiency notice).
  if (facts.status === 'closed' || facts.status === 'canceled') {
    return { action: 'none', dueAt: null, blocking: false, reasons: [] };
  }

  // A recorded debtor dispute/claim halts disposition until resolved.
  if (facts.debtorResponseAt) {
    return {
      action: 'resolve_claim',
      dueAt: null,
      blocking: true,
      reasons: ['A debtor dispute/claim was recorded; resolve it before any disposition.'],
    };
  }

  // Post-disposition: the deficiency explanation is the only remaining step,
  // and only for mid/high-value consumer collateral where it is required.
  if (facts.status === 'disposed' || facts.currentStep === 'disposed') {
    if (rules.deficiencyNoticeRequired && facts.valueTier !== 'low') {
      return {
        action: 'send_deficiency_notice',
        dueAt: null,
        blocking: false,
        reasons: ['Send the post-disposition explanation of surplus/deficiency (UCC 9-616).'],
      };
    }
    return { action: 'none', dueAt: null, blocking: false, reasons: [] };
  }

  // Statutory prerequisites already satisfied.
  if (facts.status === 'ready_for_disposition' || facts.currentStep === 'ready_for_disposition') {
    return {
      action: 'conduct_disposition',
      dueAt: null,
      blocking: false,
      reasons: ['Statutory prerequisites satisfied; the collateral may be disposed of.'],
    };
  }

  switch (facts.currentStep) {
    case 'opened':
      if (rules.preRepoNoticeRequired && !facts.defaultNoticeSentAt) {
        return {
          action: 'send_pre_repo_notice',
          dueAt: today,
          blocking: true,
          reasons: ['Send the Notice of Default and Right to Cure before repossession.'],
        };
      }
      return {
        action: 'complete_repossession',
        dueAt: null,
        blocking: true,
        reasons: [`Recover the vehicle (peaceful repossession: ${rules.breachOfPeaceStandard}).`],
      };

    case 'pre_repo_notice_sent': {
      if (isPreRepoCurePending(facts, rules, today)) {
        const cureEnds = addUtcDays(
          facts.defaultNoticeSentAt ?? facts.openedAt,
          rules.preRepoNoticeDays,
        );
        return {
          action: 'await_cure_period',
          dueAt: cureEnds,
          blocking: true,
          reasons: [`The right-to-cure period ends ${cureEnds.toISOString().slice(0, 10)}.`],
        };
      }
      return {
        action: 'complete_repossession',
        dueAt: null,
        blocking: true,
        reasons: [`Cure period elapsed; recover the vehicle (${rules.breachOfPeaceStandard}).`],
      };
    }

    case 'repossessed':
      if (!facts.personalPropertySecuredAt) {
        return {
          action: 'secure_personal_property',
          dueAt: facts.repossessedAt ?? today,
          blocking: true,
          reasons: [
            `Inventory and secure personal property from the vehicle (hold ${rules.personalPropertyHoldDays} days).`,
          ],
        };
      }
      if (!facts.postRepoNoticeSentAt) {
        return {
          action: 'send_post_repo_notice',
          dueAt: facts.repossessedAt ?? today,
          blocking: true,
          reasons: ['Send the post-repossession Notice of Intent to dispose (UCC 9-611/9-614).'],
        };
      }
      return waitingAction(facts, rules, today);

    case 'post_repo_notice_sent':
      return waitingAction(facts, rules, today);

    case 'redemption_period':
      return waitingAction(facts, rules, today);

    default:
      return { action: 'none', dueAt: null, blocking: false, reasons: [] };
  }
}

function waitingAction(
  facts: RepoCaseFacts,
  rules: RepoStateRules,
  today: Date,
): ComputedNextAction {
  // The post-repossession notice must be on file before the redemption window
  // can close — without it, route the operator back to send it.
  if (!facts.postRepoNoticeSentAt) {
    return {
      action: 'send_post_repo_notice',
      dueAt: facts.repossessedAt ?? today,
      blocking: true,
      reasons: ['Send the post-repossession Notice of Intent to dispose (UCC 9-611/9-614).'],
    };
  }
  const earliest = computeEarliestDispositionDate(facts, rules);
  if (today.getTime() >= earliest.getTime()) {
    return {
      action: 'mark_ready_for_disposition',
      dueAt: earliest,
      blocking: true,
      reasons: ['The redemption / notice period has elapsed; mark the case ready for disposition.'],
    };
  }
  return {
    action: 'await_redemption_period',
    dueAt: earliest,
    blocking: true,
    reasons: [`The redemption / notice period ends ${earliest.toISOString().slice(0, 10)}.`],
  };
}
