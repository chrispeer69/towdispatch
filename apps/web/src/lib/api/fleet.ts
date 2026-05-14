/**
 * Server-side fetchers for the fleet pages.
 *
 * Lives next to resources.ts so the trucks/drivers list pages can pre-fetch
 * data on the server (RSC) and avoid the loading flash. Client-side mutations
 * still flow through /api/fleet/* so refresh-on-401 is centralized.
 */
import type {
  DocumentDto,
  DriverDto,
  DriverTruckAssignmentDto,
  DvirDto,
  ExpirationsResponse,
  MaintenanceRecordDto,
  MaintenanceScheduleDto,
  PaginatedDrivers,
  PaginatedTrucks,
  TruckDto,
} from '@ustowdispatch/shared';
import { apiServer } from './client';

const qs = (q: Record<string, string | undefined>): string => {
  const e = Object.entries(q).filter(([, v]) => v !== undefined && v !== '');
  if (e.length === 0) return '';
  return `?${new URLSearchParams(e as [string, string][]).toString()}`;
};

export const fetchTrucks = (q: Record<string, string | undefined> = {}): Promise<PaginatedTrucks> =>
  apiServer<PaginatedTrucks>(`/fleet/trucks${qs(q)}`);

export const fetchTruck = (id: string): Promise<TruckDto> =>
  apiServer<TruckDto>(`/fleet/trucks/${id}`);

export const fetchDrivers = (
  q: Record<string, string | undefined> = {},
): Promise<PaginatedDrivers> => apiServer<PaginatedDrivers>(`/fleet/drivers${qs(q)}`);

export const fetchDriver = (id: string): Promise<DriverDto> =>
  apiServer<DriverDto>(`/fleet/drivers/${id}`);

export const fetchExpirations = (
  q: Record<string, string | undefined> = {},
): Promise<ExpirationsResponse> => apiServer<ExpirationsResponse>(`/fleet/expirations${qs(q)}`);

export const fetchDueMaintenance = (): Promise<MaintenanceScheduleDto[]> =>
  apiServer<MaintenanceScheduleDto[]>('/fleet/maintenance/due');

export const fetchTruckSchedules = (truckId: string): Promise<MaintenanceScheduleDto[]> =>
  apiServer<MaintenanceScheduleDto[]>(`/fleet/trucks/${truckId}/maintenance/schedules`);

export const fetchTruckRecords = (truckId: string): Promise<MaintenanceRecordDto[]> =>
  apiServer<MaintenanceRecordDto[]>(`/fleet/trucks/${truckId}/maintenance/records`);

export const fetchDocuments = (q: Record<string, string | undefined>): Promise<DocumentDto[]> =>
  apiServer<DocumentDto[]>(`/fleet/documents${qs(q)}`);

export const fetchDvirs = (q: Record<string, string | undefined> = {}): Promise<DvirDto[]> =>
  apiServer<DvirDto[]>(`/fleet/dvirs${qs(q)}`);

export const fetchDriverTrucks = (driverId: string): Promise<DriverTruckAssignmentDto[]> =>
  apiServer<DriverTruckAssignmentDto[]>(`/fleet/drivers/${driverId}/trucks`);

export const fetchTruckDrivers = (truckId: string): Promise<DriverTruckAssignmentDto[]> =>
  apiServer<DriverTruckAssignmentDto[]>(`/fleet/trucks/${truckId}/drivers`);
