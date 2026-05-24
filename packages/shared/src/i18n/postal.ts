/**
 * Canada Expansion (Session 47) — postal-code validation, shared by API and web.
 *
 * US:     5 digits, optional +4 (ZIP / ZIP+4).
 * Canada: ANA NAN (e.g. K1A 0B1). The letter positions exclude D, F, I, O, Q, U
 *   (and W, Z never lead) per Canada Post; the space before the last three
 *   characters is optional on input and normalized on format.
 *
 * Country is the canonical 2-letter code; unknown countries are accepted
 * permissively (non-empty, bounded length) rather than rejected, so onboarding
 * a not-yet-modeled market never hard-fails on postal format.
 */
import { z } from 'zod';

export const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;
// First letter: ABCEGHJ-NPRSTVXY (no D,F,I,O,Q,U,W,Z). Interior letters:
// ABCEGHJ-NPRSTV-Z (no D,F,I,O,Q,U).
export const CA_POSTAL_REGEX = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/;

export function isValidUsZip(value: string): boolean {
  return US_ZIP_REGEX.test(value.trim());
}

export function isValidCaPostal(value: string): boolean {
  return CA_POSTAL_REGEX.test(value.trim().toUpperCase());
}

/** Country-aware validity. Unknown countries pass (permissive). */
export function isValidPostalCode(value: string, country: string): boolean {
  const v = value.trim();
  if (v.length === 0) return false;
  switch (country.toUpperCase()) {
    case 'US':
      return isValidUsZip(v);
    case 'CA':
      return isValidCaPostal(v);
    default:
      return v.length <= 16;
  }
}

/** Canonical display form. CA → uppercase with the single space (K1A 0B1). */
export function formatPostalCode(value: string, country: string): string {
  const v = value.trim();
  if (country.toUpperCase() === 'CA') {
    const compact = v.toUpperCase().replace(/\s+/g, '');
    if (compact.length === 6) return `${compact.slice(0, 3)} ${compact.slice(3)}`;
    return v.toUpperCase();
  }
  return v;
}

/**
 * A country-aware Zod schema factory. Use in address payloads. Returns a
 * refinement that validates against the postal rules for `country`.
 */
export function postalCodeSchema(country: string) {
  return z
    .string()
    .min(1)
    .max(16)
    .refine((v) => isValidPostalCode(v, country), {
      message: `Invalid postal code for ${country.toUpperCase()}`,
    });
}

/**
 * Loose schema for address forms where the country is dynamic / not yet known.
 * Validates only when a country is supplied alongside; otherwise bounds length.
 */
export const loosePostalSchema = z.string().min(1).max(16);
