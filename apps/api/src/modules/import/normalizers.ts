/**
 * Normalization helpers shared by every importer.
 *
 * Decisions documented in apps/api/SESSION_16_REPORT.md:
 *   - Phone → E.164 via libphonenumber-js (default region US, falls back to
 *     digit-only when parse fails — so we never reject a row over a malformed
 *     phone, but we do mark it as "raw" in the result).
 *   - Email → trimmed lowercase.
 *   - Currency → dollars (string or number) → integer cents. Floating-point
 *     dollars are multiplied by 100 with Math.round to avoid 12.99 → 1298.
 *   - Timezone → Towbook stores America/New_York; we convert to UTC on insert.
 *     The parse uses a string-with-no-zone interpretation and applies the
 *     NY offset (DST-aware) before producing the UTC ISO string.
 *   - VIN check digit → warn, don't reject (older Towbook data has bad VINs).
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export const normalizeEmail = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
};

export const normalizePhone = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = parsePhoneNumberFromString(trimmed, 'US');
  if (parsed?.isValid()) return parsed.format('E.164');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 7 ? digits : null;
};

export const normalizeString = (raw: string | null | undefined): string | null => {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim();
  return t.length === 0 ? null : t;
};

export const isBlank = (raw: string | null | undefined): boolean => {
  if (raw === null || raw === undefined) return true;
  return String(raw).trim().length === 0;
};

/**
 * Convert "12.99" or "12" or "$12.99" or "1,299.00" → 1299, 1200, 1299, 129900 cents.
 * Returns null on any parse failure.
 */
export const dollarsToCents = (raw: string | null | undefined): number | null => {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim();
  if (t.length === 0) return null;
  const cleaned = t.replace(/[$,]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

/**
 * Parse a Towbook timestamp (assumed America/New_York) into a UTC ISO string.
 * Accepts:
 *   - "2024-03-15 14:32:00"
 *   - "2024-03-15T14:32:00"
 *   - "3/15/2024 2:32 PM"
 *   - already-UTC ISO ("...Z" or "...+00:00") — passed through
 *
 * Returns null on any parse failure.
 */
export const parseTowbookTimestamp = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const t = String(raw).trim();
  if (t.length === 0) return null;

  // Already has explicit timezone: trust it.
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  let normalised = t.replace('T', ' ');

  // US-style "3/15/2024 2:32 PM" → "2024-03-15 14:32:00"
  const usMatch = normalised.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/,
  );
  if (usMatch) {
    const [, m, d, y, hh, mm, ss, ampm] = usMatch;
    let hour = Number(hh);
    if (ampm) {
      const up = ampm.toUpperCase();
      if (up === 'PM' && hour < 12) hour += 12;
      if (up === 'AM' && hour === 12) hour = 0;
    }
    normalised = `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${mm}:${ss ?? '00'}`;
  }

  // Now expect "YYYY-MM-DD HH:MM:SS"
  const isoMatch = normalised.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!isoMatch) {
    // bare date "2024-03-15"
    const dateOnly = normalised.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      return interpretAsEastern(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]} 00:00:00`);
    }
    return null;
  }
  const [, y, mo, d, h, mi, s] = isoMatch;
  return interpretAsEastern(`${y}-${mo}-${d} ${h}:${mi}:${s ?? '00'}`);
};

/**
 * Treat the input string as a wall-clock time in America/New_York and
 * produce a UTC ISO string. We compute the offset by formatting the
 * candidate UTC instant back into America/New_York and seeing what hour it
 * lands on — DST-correct without pulling in a tz library.
 */
function interpretAsEastern(wallClock: string): string {
  // Start by assuming -05:00 (EST), then correct based on DST.
  const probe = new Date(`${wallClock.replace(' ', 'T')}Z`);
  if (Number.isNaN(probe.getTime())) return new Date().toISOString();
  // Render the probe in America/New_York and see what wall-clock time it shows.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(probe);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const easternWall = `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour').replace('24', '00')}:${pick('minute')}:${pick('second')}`;
  // The diff between desired wall and probe's eastern wall is the offset error.
  const desired = Date.parse(`${wallClock.replace(' ', 'T')}Z`);
  const probeEasternUtc = Date.parse(`${easternWall.replace(' ', 'T')}Z`);
  const offsetMs = probeEasternUtc - desired;
  return new Date(probe.getTime() - offsetMs).toISOString();
}

/**
 * VIN check-digit validator. Returns true if valid; false otherwise. Per the
 * spec we warn-but-accept invalid VINs (older Towbook data is dirty).
 */
export const isValidVin = (raw: string | null | undefined): boolean => {
  if (!raw) return false;
  const vin = raw.toUpperCase().trim();
  if (vin.length !== 17) return false;
  if (/[IOQ]/.test(vin)) return false;
  const trans: Record<string, number> = {
    A: 1,
    B: 2,
    C: 3,
    D: 4,
    E: 5,
    F: 6,
    G: 7,
    H: 8,
    J: 1,
    K: 2,
    L: 3,
    M: 4,
    N: 5,
    P: 7,
    R: 9,
    S: 2,
    T: 3,
    U: 4,
    V: 5,
    W: 6,
    X: 7,
    Y: 8,
    Z: 9,
    '0': 0,
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
  };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = trans[vin[i] as string];
    if (v === undefined) return false;
    sum += v * (weights[i] as number);
  }
  const rem = sum % 11;
  const expected = rem === 10 ? 'X' : String(rem);
  return vin[8] === expected;
};

/** Looks up a Towbook free-text value in the value_maps and returns the canonical US Tow Dispatch enum value or null. */
export const mapValue = (
  maps: Record<string, Record<string, string>>,
  key: string,
  raw: string | null | undefined,
): string | null => {
  if (!raw) return null;
  const t = String(raw).trim();
  if (t.length === 0) return null;
  const map = maps[key];
  if (!map) return t;
  return map[t] ?? null;
};
