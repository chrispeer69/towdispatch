'use client';
/**
 * Canada Expansion (Session 47) — tenant-aware presentation formatters.
 *
 * Binds the shared pure formatters to the current tenant's currency / unit
 * system and the resolved locale (user preference over tenant default). Use on
 * authenticated screens (invoice, job detail, dispatch board, lien, impound)
 * instead of the per-module hard-coded USD/en-US formatters.
 *
 * Canonical storage is unchanged: pass cents for money and canonical MILES for
 * distance; the hook converts/formats for display only.
 */
import { useSession } from '@/components/app-shell/session-provider';
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_UNIT_SYSTEM,
  type SupportedLocale,
  type UnitSystem,
  formatDate,
  formatDateTime,
  formatDistance,
  formatMoney,
  formatTemperature,
  resolveLocale,
} from '@ustowdispatch/shared';
import { useMemo } from 'react';

export interface TenantFormatters {
  locale: SupportedLocale;
  currency: string;
  unitSystem: UnitSystem;
  /** Format integer cents in the tenant currency. */
  money: (cents: number) => string;
  /** Format a canonical distance in miles for the tenant unit system. */
  distanceMiles: (miles: number) => string;
  /** Format a Celsius temperature for the tenant unit system. */
  temperatureC: (celsius: number) => string;
  /** Date + time in the tenant locale (local-time presentation). */
  dateTime: (value: Date | string, timeZone?: string) => string;
  /** Date only in the tenant locale. */
  date: (value: Date | string, timeZone?: string) => string;
}

export function useTenantFormatters(): TenantFormatters {
  const session = useSession();
  const tenant = session.tenant;
  const locale = resolveLocale({
    userPreference: session.user.localePreference,
    tenantDefault: tenant.defaultLocale ?? DEFAULT_LOCALE,
  });
  const currency = tenant.defaultCurrency ?? DEFAULT_CURRENCY;
  const unitSystem = tenant.defaultUnitSystem ?? DEFAULT_UNIT_SYSTEM;

  return useMemo<TenantFormatters>(() => {
    const toDate = (v: Date | string): Date => (typeof v === 'string' ? new Date(v) : v);
    return {
      locale,
      currency,
      unitSystem,
      money: (cents) => formatMoney(cents, currency, locale),
      distanceMiles: (miles) => formatDistance(miles, unitSystem, locale),
      temperatureC: (celsius) => formatTemperature(celsius, unitSystem, locale),
      dateTime: (value, timeZone) => formatDateTime(toDate(value), locale, timeZone),
      date: (value, timeZone) => formatDate(toDate(value), locale, timeZone),
    };
  }, [locale, currency, unitSystem]);
}
