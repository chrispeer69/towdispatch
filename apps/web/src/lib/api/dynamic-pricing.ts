/**
 * Server-side typed fetchers for the Dynamic Pricing Engine. Mirrors
 * the AR/Account Rate Cards patterns: every call goes through apiServer
 * so the access cookie stays server-only.
 */
import { apiServer } from './client';
import type {
  DynamicPricingDemandSurgeSuggestionDto,
  DynamicPricingHolidayDto,
  DynamicPricingNoaaMappingDto,
  DynamicPricingPulseToday,
  DynamicPricingTenantSettings,
  DynamicPricingTierDto,
  TierHistoryRow,
  TierPerformanceRow,
  OverrideReportRow,
  YearOverYearGated,
} from '@ustowdispatch/shared';

export async function fetchTiers(token?: string | null): Promise<DynamicPricingTierDto[]> {
  return apiServer<DynamicPricingTierDto[]>('/dynamic-pricing/tiers', {
    accessToken: token ?? null,
  });
}

export async function fetchPulseToday(
  token?: string | null,
): Promise<DynamicPricingPulseToday> {
  return apiServer<DynamicPricingPulseToday>('/dynamic-pricing/pulse/today', {
    accessToken: token ?? null,
  });
}

export async function fetchNoaaMappings(
  token?: string | null,
): Promise<DynamicPricingNoaaMappingDto[]> {
  return apiServer<DynamicPricingNoaaMappingDto[]>('/dynamic-pricing/noaa-mappings', {
    accessToken: token ?? null,
  });
}

export async function fetchHolidays(
  token?: string | null,
): Promise<DynamicPricingHolidayDto[]> {
  return apiServer<DynamicPricingHolidayDto[]>('/dynamic-pricing/holidays', {
    accessToken: token ?? null,
  });
}

export async function fetchDynamicPricingSettings(
  token?: string | null,
): Promise<DynamicPricingTenantSettings> {
  return apiServer<DynamicPricingTenantSettings>('/dynamic-pricing/settings', {
    accessToken: token ?? null,
  });
}

export async function fetchPendingDemandSurgeSuggestions(
  token?: string | null,
): Promise<DynamicPricingDemandSurgeSuggestionDto[]> {
  return apiServer<DynamicPricingDemandSurgeSuggestionDto[]>(
    '/dynamic-pricing/demand-surge/suggestions',
    {
      accessToken: token ?? null,
    },
  );
}

export async function fetchTierHistoryReport(
  query: { from?: string; to?: string } = {},
  token?: string | null,
): Promise<TierHistoryRow[]> {
  const qs = new URLSearchParams();
  if (query.from) qs.set('from', query.from);
  if (query.to) qs.set('to', query.to);
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiServer<TierHistoryRow[]>(`/dynamic-pricing/reports/tier-history${tail}`, {
    accessToken: token ?? null,
  });
}

export async function fetchTierPerformanceReport(
  query: { from?: string; to?: string } = {},
  token?: string | null,
): Promise<TierPerformanceRow[]> {
  const qs = new URLSearchParams();
  if (query.from) qs.set('from', query.from);
  if (query.to) qs.set('to', query.to);
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiServer<TierPerformanceRow[]>(`/dynamic-pricing/reports/tier-performance${tail}`, {
    accessToken: token ?? null,
  });
}

export async function fetchOverrideReport(
  query: { from?: string; to?: string } = {},
  token?: string | null,
): Promise<OverrideReportRow[]> {
  const qs = new URLSearchParams();
  if (query.from) qs.set('from', query.from);
  if (query.to) qs.set('to', query.to);
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiServer<OverrideReportRow[]>(`/dynamic-pricing/reports/overrides${tail}`, {
    accessToken: token ?? null,
  });
}

export async function fetchYearOverYearGate(
  token?: string | null,
): Promise<YearOverYearGated> {
  return apiServer<YearOverYearGated>('/dynamic-pricing/reports/year-over-year', {
    accessToken: token ?? null,
  });
}
