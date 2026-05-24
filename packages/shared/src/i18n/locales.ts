/**
 * Canada Expansion (Session 47) — locale / currency / unit-system / country
 * vocabulary, shared by API and web.
 *
 * Supported locales are intentionally a closed set for v1: US English (default),
 * Canadian English, and Canadian French. Adding a market is: add the locale
 * here, add a messages bundle in apps/web, translate.
 */
import { z } from 'zod';

export const supportedLocales = ['en-US', 'en-CA', 'fr-CA'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en-US';
export const localeSchema = z.enum(supportedLocales);

export const supportedCountries = ['US', 'CA'] as const;
export type SupportedCountry = (typeof supportedCountries)[number];
export const DEFAULT_COUNTRY: SupportedCountry = 'US';
/** ISO 3166-1 alpha-2; format-validated (forward-compatible to new markets). */
export const countrySchema = z.string().regex(/^[A-Z]{2}$/, 'Two-letter ISO 3166-1 country code');

export const supportedCurrencies = ['USD', 'CAD'] as const;
export type SupportedCurrency = (typeof supportedCurrencies)[number];
export const DEFAULT_CURRENCY: SupportedCurrency = 'USD';
/** ISO 4217; format-validated (forward-compatible). */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Three-letter ISO 4217 currency code');

export const unitSystems = ['imperial', 'metric'] as const;
export type UnitSystem = (typeof unitSystems)[number];
export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'imperial';
export const unitSystemSchema = z.enum(unitSystems);

/** Sensible market defaults applied at tenant onboarding by country. */
export const COUNTRY_DEFAULTS: Record<
  SupportedCountry,
  { locale: SupportedLocale; currency: SupportedCurrency; unitSystem: UnitSystem }
> = {
  US: { locale: 'en-US', currency: 'USD', unitSystem: 'imperial' },
  CA: { locale: 'en-CA', currency: 'CAD', unitSystem: 'metric' },
};

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (supportedLocales as readonly string[]).includes(value);
}

/** Canada's 10 provinces + 3 territories (mirrors the `jurisdictions` seed). */
export const caProvinceCodes = [
  'ON',
  'QC',
  'BC',
  'AB',
  'MB',
  'SK',
  'NS',
  'NB',
  'NL',
  'PE',
  'YT',
  'NT',
  'NU',
] as const;
export type CaProvinceCode = (typeof caProvinceCodes)[number];
export const caProvinceSchema = z.enum(caProvinceCodes);

export function isCaProvince(value: string): value is CaProvinceCode {
  return (caProvinceCodes as readonly string[]).includes(value);
}
