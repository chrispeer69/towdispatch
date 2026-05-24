/**
 * Canada Expansion (Session 47) — presentation formatting + unit conversion.
 *
 * INVARIANTS (do not change canonical storage — only presentation):
 *   - Money is stored in integer cents. Currency is a presentation choice.
 *   - Distance is stored canonical in MILES. Unit system is presentation only.
 *
 * Date/time is hand-assembled from Intl parts so the output matches the exact
 * per-locale pattern regardless of the host ICU version:
 *   en-US  M/D/YYYY h:mm AM/PM
 *   en-CA  YYYY-MM-DD HH:mm
 *   fr-CA  YYYY-MM-DD HH:mm   (AAAA-MM-JJ HH:mm — same numeric ordering)
 */
import type { SupportedLocale, UnitSystem } from './locales';

const MILES_PER_KM = 1.609344;

export function milesToKm(miles: number): number {
  return miles * MILES_PER_KM;
}
export function kmToMiles(km: number): number {
  return km / MILES_PER_KM;
}
export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}
export function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

/** Format money. `cents` is the canonical integer amount. */
export function formatMoney(cents: number, currency: string, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

/**
 * Format a canonical distance (miles) for the tenant's unit system. Metric
 * tenants see kilometers; imperial tenants see miles. Rounded to `fractionDigits`.
 */
export function formatDistance(
  canonicalMiles: number,
  unitSystem: UnitSystem,
  locale: SupportedLocale,
  fractionDigits = 1,
): string {
  const metric = unitSystem === 'metric';
  const value = metric ? milesToKm(canonicalMiles) : canonicalMiles;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: metric ? 'kilometer' : 'mile',
    unitDisplay: 'short',
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Format a temperature given in Celsius (the metric-native canonical) for the
 * tenant's unit system. Imperial tenants see Fahrenheit.
 */
export function formatTemperature(
  canonicalCelsius: number,
  unitSystem: UnitSystem,
  locale: SupportedLocale,
): string {
  const metric = unitSystem === 'metric';
  const value = metric ? canonicalCelsius : celsiusToFahrenheit(canonicalCelsius);
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: metric ? 'celsius' : 'fahrenheit',
    unitDisplay: 'short',
    maximumFractionDigits: 0,
  }).format(value);
}

interface DateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function extractParts(date: Date, timeZone: string): DateParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  // Some ICU builds emit '24' for midnight under hour12:false — normalize.
  const hour = map.hour === '24' ? '00' : (map.hour ?? '00');
  return {
    year: map.year ?? '',
    month: map.month ?? '',
    day: map.day ?? '',
    hour,
    minute: map.minute ?? '',
  };
}

/** Date only, per-locale pattern. `timeZone` defaults to UTC for determinism. */
export function formatDate(date: Date, locale: SupportedLocale, timeZone = 'UTC'): string {
  const p = extractParts(date, timeZone);
  if (locale === 'en-US') {
    return `${Number(p.month)}/${Number(p.day)}/${p.year}`;
  }
  // en-CA + fr-CA: ISO-ordered numeric date.
  return `${p.year}-${p.month}-${p.day}`;
}

/** Date + time, per-locale pattern. `timeZone` defaults to UTC for determinism. */
export function formatDateTime(date: Date, locale: SupportedLocale, timeZone = 'UTC'): string {
  const p = extractParts(date, timeZone);
  if (locale === 'en-US') {
    const h24 = Number(p.hour);
    const ampm = h24 < 12 ? 'AM' : 'PM';
    const h12 = ((h24 + 11) % 12) + 1;
    return `${Number(p.month)}/${Number(p.day)}/${p.year} ${h12}:${p.minute} ${ampm}`;
  }
  // en-CA + fr-CA: 24-hour clock.
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
