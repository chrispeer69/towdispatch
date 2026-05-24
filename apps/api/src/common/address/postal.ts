/**
 * Canada Expansion (Session 47) — postal-code validation, surfaced under the
 * API's common/ tree at the path the spec names.
 *
 * The regexes and validators are pure and shared with the web app (and the
 * shared Zod schemas), so they live in @ustowdispatch/shared. This module
 * re-exports them. Used in tenant onboarding, customer creation, and job
 * intake address validation.
 *
 *   US:     \d{5}(-\d{4})?
 *   Canada: [ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d
 */
export {
  CA_POSTAL_REGEX,
  US_ZIP_REGEX,
  formatPostalCode,
  isValidCaPostal,
  isValidPostalCode,
  isValidUsZip,
  loosePostalSchema,
  postalCodeSchema,
} from '@ustowdispatch/shared';
