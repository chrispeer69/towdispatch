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
  VehicleDto,
  VehicleWithCustomersDto,
} from '@towcommand/shared';
import { apiServer } from './client';

export async function fetchCustomers(
  query: Record<string, string | undefined>,
): Promise<PaginatedCustomers> {
  const qs = toQuery(query);
  return apiServer<PaginatedCustomers>(`/customers${qs}`);
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
): Promise<PaginatedAccounts> {
  const qs = toQuery(query);
  return apiServer<PaginatedAccounts>(`/accounts${qs}`);
}

export async function fetchAccount(id: string): Promise<AccountDto> {
  return apiServer<AccountDto>(`/accounts/${id}`);
}

export type { CustomerDto, VehicleDto, AccountDto };

function toQuery(q: Record<string, string | undefined>): string {
  const entries = Object.entries(q).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.set(k, v as string);
  return `?${params.toString()}`;
}
