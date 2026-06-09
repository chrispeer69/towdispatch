/**
 * MotorClubProvider — the dispatch protocol surface for motor clubs (Agero
 * first; Allstate, Honk, Quest, USAC, etc. later).
 *
 * Each motor club uses its own dispatch protocol (Agero ARES/Honkbook/Allstate
 * Good Hands), but the operations look the same from Tow Dispatch's view:
 * receive a job, accept/reject, send GPS+ETA, send arrived/in-tow/dropped
 * status events, submit final invoice. We model that as a thin RPC surface
 * plus an inbound-event subscription model handled by the implementation.
 */
import type { IntegrationProvider } from '../types.js';

export interface MotorClubCredentials {
  config: Record<string, unknown>;
}

export type MotorClubJobStatus =
  | 'offered'
  | 'accepted'
  | 'rejected'
  | 'enroute'
  | 'arrived'
  | 'in_tow'
  | 'completed'
  | 'cancelled';

export interface MotorClubJob {
  externalId: string;
  receivedAt: string;
  status: MotorClubJobStatus;
  service: string;
  customer: { name: string; phone?: string };
  pickup: { lat: number; lng: number; address?: string };
  dropoff?: { lat: number; lng: number; address?: string };
  vehicle?: { make?: string; model?: string; year?: number; color?: string; plate?: string };
  promisedEtaMinutes?: number;
}

export interface AcceptJobInput {
  externalId: string;
  driverName: string;
  driverPhone?: string;
  truckIdentifier?: string;
  etaMinutes: number;
}

export interface UpdateStatusInput {
  externalId: string;
  status: MotorClubJobStatus;
  at: string;
  location?: { lat: number; lng: number };
  notes?: string;
}

export interface SubmitInvoiceInput {
  externalId: string;
  amountCents: number;
  currency: string;
  lineItems: Array<{ code: string; description: string; amountCents: number }>;
}

export interface MotorClubProvider extends IntegrationProvider {
  acceptJob(creds: MotorClubCredentials, input: AcceptJobInput): Promise<MotorClubJob>;
  rejectJob(creds: MotorClubCredentials, externalId: string, reason: string): Promise<void>;
  updateStatus(creds: MotorClubCredentials, input: UpdateStatusInput): Promise<void>;
  submitInvoice(
    creds: MotorClubCredentials,
    input: SubmitInvoiceInput,
  ): Promise<{ acknowledgedAt: string }>;
  getJob(creds: MotorClubCredentials, externalId: string): Promise<MotorClubJob | null>;
}
