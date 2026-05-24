/**
 * Canada Expansion (Session 47) — locale resolution priority chain.
 * Priority (highest first): user preference → tenant default → Accept-Language
 * → en-US fallback.
 */
import {
  coerceToSupportedLocale,
  localeFromAcceptLanguage,
  resolveLocale,
} from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';

describe('coerceToSupportedLocale', () => {
  it('maps arbitrary BCP-47 tags onto the closest supported locale', () => {
    expect(coerceToSupportedLocale('fr-CA')).toBe('fr-CA');
    expect(coerceToSupportedLocale('fr-FR')).toBe('fr-CA');
    expect(coerceToSupportedLocale('en-US')).toBe('en-US');
    expect(coerceToSupportedLocale('en-GB')).toBe('en-CA');
    expect(coerceToSupportedLocale('de-DE')).toBeNull();
    expect(coerceToSupportedLocale(null)).toBeNull();
  });
});

describe('localeFromAcceptLanguage', () => {
  it('honors q-weights and returns the first supported match', () => {
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr-CA');
    expect(localeFromAcceptLanguage('en-US;q=0.5,fr-CA;q=0.9')).toBe('fr-CA');
    expect(localeFromAcceptLanguage('de-DE,it;q=0.5')).toBeNull();
    expect(localeFromAcceptLanguage('')).toBeNull();
  });
});

describe('resolveLocale priority chain', () => {
  it('user preference overrides the tenant default', () => {
    expect(resolveLocale({ userPreference: 'fr-CA', tenantDefault: 'en-US' })).toBe('fr-CA');
  });

  it('falls to tenant default when there is no user preference', () => {
    expect(resolveLocale({ tenantDefault: 'en-CA' })).toBe('en-CA');
  });

  it('falls to Accept-Language when neither user nor tenant is set', () => {
    expect(resolveLocale({ acceptLanguage: 'fr-FR,en;q=0.8' })).toBe('fr-CA');
  });

  it('falls to en-US as the final default', () => {
    expect(resolveLocale({})).toBe('en-US');
    expect(resolveLocale({ acceptLanguage: 'de-DE' })).toBe('en-US');
  });

  it('skips an unsupported user preference and uses the tenant default', () => {
    expect(resolveLocale({ userPreference: 'xx-YY', tenantDefault: 'en-CA' })).toBe('en-CA');
  });
});
