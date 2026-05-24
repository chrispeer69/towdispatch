import { describe, expect, it } from 'vitest';
import { HOS_LIMITS, type HosSegmentInput, validateHosWeek } from './hos-rules.logic.js';

const H = 3_600_000;
const seg = (
  status: HosSegmentInput['status'],
  startMs: number,
  endMs: number,
): HosSegmentInput => ({
  status,
  startAt: new Date(startMs),
  endAt: new Date(endMs),
});
const day0 = Date.UTC(2026, 4, 1, 0, 0, 0); // 2026-05-01T00:00:00Z
const at = (dayIdx: number, hour: number): number => day0 + dayIdx * 24 * H + hour * H;
const rules = (v: ReturnType<typeof validateHosWeek>): string[] => v.violations.map((x) => x.rule);
const has = (v: ReturnType<typeof validateHosWeek>, rule: string, sev?: string): boolean =>
  v.violations.some((x) => x.rule === rule && (sev === undefined || x.severity === sev));

describe('validateHosWeek — 11-hour driving limit (395.3(a)(3)(i))', () => {
  it('flags driving beyond 11h in a duty period', () => {
    // 7h drive, 30-min break, 5h drive = 12h driving in one period.
    const v = validateHosWeek([
      seg('driving', at(0, 10), at(0, 17)),
      seg('off_duty', at(0, 17), at(0, 17.5)),
      seg('driving', at(0, 17.5), at(0, 22.5)),
    ]);
    expect(has(v, 'driving_limit_11h', 'violation')).toBe(true);
    // The 30-min break keeps it off the break rule; window stays under 14h.
    expect(rules(v)).not.toContain('break_30min');
    expect(rules(v)).not.toContain('duty_window_14h');
  });

  it('allows exactly 11h driving (boundary, not >)', () => {
    const v = validateHosWeek([
      seg('driving', at(0, 10), at(0, 17)), // 7h
      seg('off_duty', at(0, 17), at(0, 17.5)), // break
      seg('driving', at(0, 17.5), at(0, 21.5)), // 4h → 11h total
    ]);
    expect(rules(v)).not.toContain('driving_limit_11h');
    expect(v.totalDrivingMinutes).toBe(HOS_LIMITS.drivingLimitMin);
  });
});

describe('validateHosWeek — 14-hour duty window (395.3(a)(2))', () => {
  it('flags driving past the 14th on-duty hour', () => {
    const v = validateHosWeek([
      seg('on_duty_not_driving', at(0, 10), at(0, 20)), // 10h on duty
      seg('driving', at(0, 20), at(1, 1)), // drives 20:00 → 01:00 next day (past 00:00 window end)
    ]);
    expect(has(v, 'duty_window_14h', 'violation')).toBe(true);
    const w = v.violations.find((x) => x.rule === 'duty_window_14h');
    expect(w?.at.getTime()).toBe(at(0, 10) + HOS_LIMITS.dutyWindowMin * 60_000);
  });

  it('does not flag when all driving is within the 14h window', () => {
    const v = validateHosWeek([
      seg('on_duty_not_driving', at(0, 10), at(0, 18)),
      seg('driving', at(0, 18), at(0, 23)), // ends 23:00, window ends 00:00
    ]);
    expect(rules(v)).not.toContain('duty_window_14h');
  });
});

describe('validateHosWeek — 30-minute break (395.3(a)(3)(ii))', () => {
  it('flags driving past 8 cumulative hours with no break', () => {
    const v = validateHosWeek([seg('driving', at(0, 8), at(0, 17))]); // 9h straight
    expect(has(v, 'break_30min', 'violation')).toBe(true);
    const b = v.violations.find((x) => x.rule === 'break_30min');
    expect(b?.at.getTime()).toBe(at(0, 8) + HOS_LIMITS.breakAfterDrivingMin * 60_000);
  });

  it('does not flag when a 30-min break precedes the 8h mark', () => {
    const v = validateHosWeek([
      seg('driving', at(0, 8), at(0, 16)), // exactly 8h (not >)
      seg('off_duty', at(0, 16), at(0, 16.5)), // 30-min break
      seg('driving', at(0, 16.5), at(0, 18.5)), // 2h more
    ]);
    expect(rules(v)).not.toContain('break_30min');
  });
});

describe('validateHosWeek — duty-period reset (395.3(a)(1))', () => {
  it('treats two 8h drives split by 10h off as separate periods (no 11h breach)', () => {
    const v = validateHosWeek([
      seg('driving', at(0, 10), at(0, 18)), // 8h
      seg('off_duty', at(0, 18), at(1, 4)), // 10h off → reset
      seg('driving', at(1, 4), at(1, 12)), // 8h in a fresh period
    ]);
    expect(rules(v)).not.toContain('driving_limit_11h');
  });

  it('keeps them in one period when off-duty is under 10h (11h breach)', () => {
    const v = validateHosWeek([
      seg('driving', at(0, 10), at(0, 18)), // 8h
      seg('off_duty', at(0, 18), at(0, 23)), // only 5h off → no reset
      seg('driving', at(0, 23), at(1, 7)), // +8h ⇒ 16h driving in one period
    ]);
    expect(has(v, 'driving_limit_11h', 'violation')).toBe(true);
  });
});

describe('validateHosWeek — rolling cycle limits (395.3(b))', () => {
  // Each day: 10h on-duty-not-driving + 1h driving + 13h off (>10h ⇒ reset).
  const dutyDay = (d: number): HosSegmentInput[] => [
    seg('on_duty_not_driving', at(d, 0), at(d, 10)),
    seg('driving', at(d, 10), at(d, 11)),
    seg('off_duty', at(d, 11), at(d + 1, 0)),
  ];

  it('flags 60h/7-day when on-duty exceeds 60h and warns on 70h/8-day', () => {
    // 6 days × 11h on-duty = 66h within the rolling window.
    const v = validateHosWeek([0, 1, 2, 3, 4, 5].flatMap(dutyDay));
    expect(has(v, 'cycle_60h_7d', 'violation')).toBe(true);
    // 66h ≥ 0.9 × 70h (63h) but < 70h ⇒ warning, not violation.
    expect(has(v, 'cycle_70h_8d', 'warning')).toBe(true);
    expect(has(v, 'cycle_70h_8d', 'violation')).toBe(false);
  });

  it('stays clean under the cycle limits', () => {
    const v = validateHosWeek([0, 1, 2].flatMap(dutyDay)); // 33h
    expect(rules(v)).not.toContain('cycle_60h_7d');
    expect(rules(v)).not.toContain('cycle_70h_8d');
  });
});

describe('validateHosWeek — totals & hygiene', () => {
  it('sums driving and on-duty minutes and ignores open segments', () => {
    const v = validateHosWeek([
      seg('on_duty_not_driving', at(0, 8), at(0, 10)), // 2h on duty
      seg('driving', at(0, 10), at(0, 13)), // 3h driving (also on duty)
      { status: 'driving', startAt: new Date(at(0, 13)), endAt: null }, // open ⇒ ignored
    ]);
    expect(v.totalDrivingMinutes).toBe(180);
    expect(v.totalOnDutyMinutes).toBe(300);
  });

  it('returns no violations for a clean single shift', () => {
    const v = validateHosWeek([
      seg('off_duty', at(0, 0), at(0, 10)),
      seg('driving', at(0, 10), at(0, 14)),
      seg('on_duty_not_driving', at(0, 14), at(0, 16)),
      seg('off_duty', at(0, 16), at(1, 2)),
    ]);
    expect(v.violations).toEqual([]);
  });
});
