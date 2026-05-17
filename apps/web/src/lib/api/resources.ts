/**
 * Server-side fetchers for the customer / vehicle / account resources. These
 * proxy through to the API via the same access-token cookie path that powers
 * the rest of the authenticated shell, so the access token never reaches the
 * browser bundle.
 */
import type {
  AccountDto,
  CustomerDto,
  CustomerWithVehiclesDto,
  PaginatedAccounts,
  PaginatedCustomers,
  PaginatedVehicles,
  ServiceCatalogEntryDto,
  ServiceRateDto,
  TenantDto,
  UserDto,
  VehicleDto,
  VehicleWithCustomersDto,
} from '@ustowdispatch/shared';
import { apiServer } from './client';

export async function fetchCustomers(
  query: Record<string, string | undefined>,
  accessToken?: string | null,
): Promise<PaginatedCustomers> {
  const qs = toQuery(query);
  // Token must be read inline at the page render site and threaded through —
  // see RequestOpts.accessToken in lib/api/client.ts and BUILD_DECISIONS.md
  // Session 9.7. Leaving accessToken undefined keeps the legacy inline-read
  // fallback so non-page callers (route handlers, server actions) behave as
  // before.
  return apiServer<PaginatedCustomers>(`/customers${qs}`, { accessToken: accessToken ?? null });
}

export async function fetchCustomer(id: string): Promise<CustomerWithVehiclesDto> {
  return apiServer<CustomerWithVehiclesDto>(`/customers/${id}`);
}

export async function fetchVehicles(
  query: Record<string, string | undefined>,
): Promise<PaginatedVehicles> {
  const qs = toQuery(query);
  return apiServer<PaginatedVehicles>(`/vehicles${qs}`);
}

export async function fetchVehicle(id: string): Promise<VehicleWithCustomersDto> {
  return apiServer<VehicleWithCustomersDto>(`/vehicles/${id}`);
}

export async function fetchAccounts(
  query: Record<string, string | undefined>,
  accessToken?: string | null,
): Promise<PaginatedAccounts> {
  const qs = toQuery(query);
  return apiServer<PaginatedAccounts>(`/accounts${qs}`, { accessToken: accessToken ?? null });
}

export async function fetchAccount(id: string): Promise<AccountDto> {
  return apiServer<AccountDto>(`/accounts/${id}`);
}

export async function fetchServiceCatalog(
  query: Record<string, string | undefined>,
  accessToken?: string | null,
): Promise<ServiceCatalogEntryDto[]> {
  const qs = toQuery(query);
  return apiServer<ServiceCatalogEntryDto[]>(`/service-catalog${qs}`, {
    accessToken: accessToken ?? null,
  });
}

export async function fetchServiceRates(accessToken?: string | null): Promise<ServiceRateDto[]> {
  return apiServer<ServiceRateDto[]>('/service-rates', {
    accessToken: accessToken ?? null,
  });
}

export async function fetchTenantCurrent(accessToken?: string | null): Promise<TenantDto> {
  return apiServer<TenantDto>('/tenants/current', {
    accessToken: accessToken ?? null,
  });
}

export async function fetchUsers(accessToken?: string | null): Promise<UserDto[]> {
  return apiServer<UserDto[]>('/users', {
    accessToken: accessToken ?? null,
  });
}

export type {
  CustomerDto,
  VehicleDto,
  AccountDto,
  ServiceCatalogEntryDto,
  ServiceRateDto,
  TenantDto,
  UserDto,
};

function toQuery(q: Record<string, string | undefined>): string {
  const entries = Object.entries(q).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.set(k, v as string);
  return `?${params.toString()}`;
}
