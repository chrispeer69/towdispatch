/**
 * Pure next-run clock for builder template schedules.
 *
 * Honors delivery_at_local (HH:MM), delivery_dow (weekly), delivery_dom
 * (monthly). Computed against the UTC wall clock — tenant-timezone offset is a
 * documented follow-up, matching the Session 14 schedule-clock convention.
 * Pure + deterministic so the DST / weekend / month-boundary edges are
 * unit-testable.
 */
export interface TemplateScheduleTiming {
  cadence: 'daily' | 'weekly' | 'monthly';
  /** 'HH:MM' or 'HH:MM:SS'. */
  deliveryAtLocal: string;
  /** 0=Sunday..6=Saturday; weekly only. Defaults to Monday. */
  deliveryDow: number | null;
  /** 1..28; monthly only. Defaults to the 1st. */
  deliveryDom: number | null;
}

export function computeTemplateNextRun(s: TemplateScheduleTiming, now: Date): Date {
  const { hour, minute } = parseHhmm(s.deliveryAtLocal);
  switch (s.cadence) {
    case 'daily':
      return nextDaily(now, hour, minute);
    case 'weekly':
      return nextWeekly(now, hour, minute, clampDow(s.deliveryDow));
    case 'monthly':
      return nextMonthly(now, hour, minute, clampDom(s.deliveryDom));
  }
}

function parseHhmm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':');
  const hour = Number(h);
  const minute = Number(m);
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return { hour: 6, minute: 0 };
  }
  return { hour, minute };
}

function clampDow(dow: number | null): number {
  if (dow === null || !Number.isInteger(dow) || dow < 0 || dow > 6) return 1; // Monday
  return dow;
}

function clampDom(dom: number | null): number {
  if (dom === null || !Number.isInteger(dom) || dom < 1 || dom > 28) return 1;
  return dom;
}

function atUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
}

function nextDaily(now: Date, hour: number, minute: number): Date {
  const c = atUtc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute);
  if (c.getTime() <= now.getTime()) c.setUTCDate(c.getUTCDate() + 1);
  return c;
}

function nextWeekly(now: Date, hour: number, minute: number, targetDow: number): Date {
  const c = atUtc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute);
  let deltaDays = (targetDow - c.getUTCDay() + 7) % 7;
  if (deltaDays === 0 && c.getTime() <= now.getTime()) deltaDays = 7;
  c.setUTCDate(c.getUTCDate() + deltaDays);
  return c;
}

function nextMonthly(now: Date, hour: number, minute: number, targetDom: number): Date {
  const thisMonth = atUtc(now.getUTCFullYear(), now.getUTCMonth(), targetDom, hour, minute);
  if (thisMonth.getTime() > now.getTime()) return thisMonth;
  return atUtc(now.getUTCFullYear(), now.getUTCMonth() + 1, targetDom, hour, minute);
}
