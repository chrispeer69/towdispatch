/**
 * Hours-of-service rule engine (pure) — Full DOT Compliance, Session 37.
 *
 * Property-carrying ruleset only this session (49 CFR 395.3 / 395.8). The
 * limits are a typed config so each rule is independently citable and
 * unit-testable; the statutory section sits next to every number. No ELD
 * input — these operate on manually entered duty-status segments.
 *
 * Rules implemented:
 *   • 11-hour driving limit          — 395.3(a)(3)(i)
 *   • 14-hour duty-window limit       — 395.3(a)(2)
 *   • 30-minute break after 8h drive  — 395.3(a)(3)(ii)
 *   • 60-hour / 7-day rolling cycle   — 395.3(b)(1)
 *   • 70-hour / 8-day rolling cycle   — 395.3(b)(2)
 *
 * A duty period resets after ≥10 consecutive hours off duty
 * (off_duty + sleeper) — 395.3(a)(1). The 11h/14h/30-min rules are
 * evaluated per duty period; the cycle rules roll across the whole window.
 */
import type {
  DotHosStatus,
  DotHosViolationRule,
  DotHosViolationSeverity,
} from '@ustowdispatch/shared';

export const HOS_LIMITS = {
  /** 11h — 395.3(a)(3)(i). */
  drivingLimitMin: 11 * 60,
  /** 14h — 395.3(a)(2). */
  dutyWindowMin: 14 * 60,
  /** 8h cumulative driving triggers the break requirement — 395.3(a)(3)(ii). */
  breakAfterDrivingMin: 8 * 60,
  /** A qualifying break is ≥30 min not driving. */
  breakMinDurationMin: 30,
  /** ≥10 consecutive off-duty hours resets the duty period — 395.3(a)(1). */
  offDutyResetMin: 10 * 60,
  /** Rolling on-duty cycles — 395.3(b). */
  cycles: [
    { rule: 'cycle_60h_7d' as const, limitMin: 60 * 60, days: 7 },
    { rule: 'cycle_70h_8d' as const, limitMin: 70 * 60, days: 8 },
  ],
  /** Fraction of a cycle limit that emits a 'warning' before the breach. */
  warnRatio: 0.9,
} as const;

export interface HosSegmentInput {
  status: DotHosStatus;
  startAt: Date;
  endAt: Date | null;
}

export interface HosViolation {
  rule: DotHosViolationRule;
  at: Date;
  severity: DotHosViolationSeverity;
  detail: string;
}

export interface HosWeekEvaluation {
  totalDrivingMinutes: number;
  totalOnDutyMinutes: number;
  violations: HosViolation[];
}

interface Seg extends HosSegmentInput {
  endAt: Date; // narrowed: open segments are dropped before evaluation
  durationMin: number;
}

const minutesBetween = (a: Date, b: Date): number => (b.getTime() - a.getTime()) / 60_000;
const addMinutes = (d: Date, m: number): Date => new Date(d.getTime() + m * 60_000);
const isOffDuty = (s: DotHosStatus): boolean => s === 'off_duty' || s === 'sleeper';
const isOnDuty = (s: DotHosStatus): boolean => s === 'driving' || s === 'on_duty_not_driving';

/**
 * Evaluate one driver's duty-status segments for HOS violations. Segments
 * without an end time are ignored (an in-progress segment has no duration);
 * the remainder are sorted by start time.
 */
export function validateHosWeek(input: HosSegmentInput[]): HosWeekEvaluation {
  const segs: Seg[] = input
    .filter((s): s is HosSegmentInput & { endAt: Date } => s.endAt !== null)
    .map((s) => ({ ...s, endAt: s.endAt as Date, durationMin: minutesBetween(s.startAt, s.endAt) }))
    .filter((s) => s.durationMin > 0)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const violations: HosViolation[] = [];
  let totalDrivingMinutes = 0;
  let totalOnDutyMinutes = 0;
  for (const s of segs) {
    if (s.status === 'driving') totalDrivingMinutes += s.durationMin;
    if (isOnDuty(s.status)) totalOnDutyMinutes += s.durationMin;
  }

  evaluateDutyPeriods(segs, violations);
  evaluateCycles(segs, violations);

  violations.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { totalDrivingMinutes, totalOnDutyMinutes, violations };
}

/** Assign each segment to a duty period (−1 = before the first on-duty). */
function assignPeriods(segs: Seg[]): number[] {
  const periodOf = new Array<number>(segs.length).fill(-1);
  let period = -1;
  let offRun = 0;
  let started = false;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] as Seg;
    if (isOffDuty(s.status)) {
      offRun += s.durationMin;
      periodOf[i] = started ? period : -1;
    } else {
      if (!started || offRun >= HOS_LIMITS.offDutyResetMin) {
        period += 1;
        started = true;
      }
      offRun = 0;
      periodOf[i] = period;
    }
  }
  return periodOf;
}

/** 11h driving, 14h window, and 30-min break — per duty period. */
function evaluateDutyPeriods(segs: Seg[], out: HosViolation[]): void {
  const periodOf = assignPeriods(segs);
  const periods = new Set(periodOf.filter((p) => p >= 0));

  for (const p of periods) {
    const members = segs.filter((_, i) => periodOf[i] === p);
    if (members.length === 0) continue;
    const windowStart = (members[0] as Seg).startAt;
    const windowEnds = addMinutes(windowStart, HOS_LIMITS.dutyWindowMin);

    let cumulativeDriving = 0;
    let drivingSinceBreak = 0;
    let firedDriving = false;
    let firedWindow = false;
    let firedBreak = false;

    for (const s of members) {
      // A qualifying ≥30-min non-driving break resets the 8h driving counter.
      if (s.status !== 'driving' && s.durationMin >= HOS_LIMITS.breakMinDurationMin) {
        drivingSinceBreak = 0;
      }
      if (s.status !== 'driving') continue;

      // 14-hour duty window: driving past the 14th hour is a violation.
      if (!firedWindow && s.endAt.getTime() > windowEnds.getTime()) {
        firedWindow = true;
        out.push({
          rule: 'duty_window_14h',
          at: windowEnds,
          severity: 'violation',
          detail: 'Driving past the 14-hour on-duty window (395.3(a)(2)).',
        });
      }

      // 11-hour driving limit.
      if (!firedDriving && cumulativeDriving + s.durationMin > HOS_LIMITS.drivingLimitMin) {
        firedDriving = true;
        out.push({
          rule: 'driving_limit_11h',
          at: addMinutes(s.startAt, HOS_LIMITS.drivingLimitMin - cumulativeDriving),
          severity: 'violation',
          detail: 'Driving beyond 11 hours in the duty period (395.3(a)(3)(i)).',
        });
      }

      // 30-minute break after 8 cumulative driving hours.
      if (!firedBreak && drivingSinceBreak + s.durationMin > HOS_LIMITS.breakAfterDrivingMin) {
        firedBreak = true;
        out.push({
          rule: 'break_30min',
          at: addMinutes(s.startAt, HOS_LIMITS.breakAfterDrivingMin - drivingSinceBreak),
          severity: 'violation',
          detail: 'Drove past 8 cumulative hours without a 30-minute break (395.3(a)(3)(ii)).',
        });
      }

      cumulativeDriving += s.durationMin;
      drivingSinceBreak += s.durationMin;
    }
  }
}

/** 60h/7-day and 70h/8-day rolling on-duty cycles. */
function evaluateCycles(segs: Seg[], out: HosViolation[]): void {
  const drivingSegs = segs.filter((s) => s.status === 'driving');
  for (const cycle of HOS_LIMITS.cycles) {
    const windowMs = cycle.days * 24 * 60 * 60_000;
    const warnAt = cycle.limitMin * HOS_LIMITS.warnRatio;
    let firedWarn = false;
    let firedViolation = false;

    for (const d of drivingSegs) {
      if (firedViolation) break;
      const windowStartMs = d.endAt.getTime() - windowMs;
      // On-duty minutes (driving + on_duty_not_driving) anchored by end time.
      const onDuty = segs
        .filter(
          (s) =>
            isOnDuty(s.status) &&
            s.endAt.getTime() > windowStartMs &&
            s.endAt.getTime() <= d.endAt.getTime(),
        )
        .reduce((sum, s) => sum + s.durationMin, 0);

      if (onDuty > cycle.limitMin) {
        firedViolation = true;
        out.push({
          rule: cycle.rule,
          at: d.endAt,
          severity: 'violation',
          detail: `On-duty time exceeded ${cycle.limitMin / 60}h in ${cycle.days} days (395.3(b)).`,
        });
      } else if (!firedWarn && onDuty >= warnAt) {
        firedWarn = true;
        out.push({
          rule: cycle.rule,
          at: d.endAt,
          severity: 'warning',
          detail: `Approaching the ${cycle.limitMin / 60}h/${cycle.days}-day on-duty limit (395.3(b)).`,
        });
      }
    }
  }
}
