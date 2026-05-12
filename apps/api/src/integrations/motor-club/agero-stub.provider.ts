/**
 * In-memory Agero stub provider. Records every outbound RPC against the
 * provider so the E2E suite can assert the gateway pushed status updates
 * back to Agero without needing a live ARES sandbox.
 *
 * The provider is selected by MotorClubModule when AGERO_API_KEY is
 * empty (default in dev + CI). Production wires the real ARES provider
 * once that lands.
 */
import { Injectable } from '@nestjs/common';
import type { ProviderDescriptor } from '../types.js';
import type {
  AcceptJobInput,
  MotorClubCredentials,
  MotorClubJob,
  MotorClubProvider,
  SubmitInvoiceInput,
  UpdateStatusInput,
} from './motor-club-provider.interface.js';

interface RecordedCall {
  op: string;
  externalId: string;
  at: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class AgeroStubProvider implements MotorClubProvider {
  readonly descriptor: ProviderDescriptor = {
    id: 'agero-stub',
    displayName: 'Agero (in-memory stub)',
    vendor: 'agero',
    capabilities: ['dispatch_in', 'status_out', 'invoice_out'],
  };
  private readonly jobs = new Map<string, MotorClubJob>();
  private readonly outbox: RecordedCall[] = [];

  /** Seed an inbound job. The gateway controller calls this on dispatch. */
  ingest(job: MotorClubJob): void {
    this.jobs.set(job.externalId, job);
    this.outbox.push({
      op: 'ingest',
      externalId: job.externalId,
      at: new Date().toISOString(),
      payload: job as unknown as Record<string, unknown>,
    });
  }

  async acceptJob(_c: MotorClubCredentials, input: AcceptJobInput): Promise<MotorClubJob> {
    const job = this.jobs.get(input.externalId);
    if (!job) throw new Error(`unknown job ${input.externalId}`);
    const next: MotorClubJob = { ...job, status: 'accepted' };
    this.jobs.set(input.externalId, next);
    this.outbox.push({
      op: 'acceptJob',
      externalId: input.externalId,
      at: new Date().toISOString(),
      payload: input as unknown as Record<string, unknown>,
    });
    return next;
  }

  async rejectJob(_c: MotorClubCredentials, externalId: string, reason: string): Promise<void> {
    this.jobs.delete(externalId);
    this.outbox.push({
      op: 'rejectJob',
      externalId,
      at: new Date().toISOString(),
      payload: { reason },
    });
  }

  async updateStatus(_c: MotorClubCredentials, input: UpdateStatusInput): Promise<void> {
    const job = this.jobs.get(input.externalId);
    if (job) this.jobs.set(input.externalId, { ...job, status: input.status });
    this.outbox.push({
      op: 'updateStatus',
      externalId: input.externalId,
      at: new Date().toISOString(),
      payload: input as unknown as Record<string, unknown>,
    });
  }

  async submitInvoice(
    _c: MotorClubCredentials,
    input: SubmitInvoiceInput,
  ): Promise<{ acknowledgedAt: string }> {
    const at = new Date().toISOString();
    this.outbox.push({
      op: 'submitInvoice',
      externalId: input.externalId,
      at,
      payload: input as unknown as Record<string, unknown>,
    });
    return { acknowledgedAt: at };
  }

  async getJob(_c: MotorClubCredentials, externalId: string): Promise<MotorClubJob | null> {
    return this.jobs.get(externalId) ?? null;
  }

  /** Test-only introspection. Used by /motor-club/agero/_test/outbox. */
  getOutbox(): RecordedCall[] {
    return this.outbox.slice();
  }

  /** Test-only reset. Called between E2E runs to keep state hygienic. */
  clear(): void {
    this.jobs.clear();
    this.outbox.length = 0;
  }
}
