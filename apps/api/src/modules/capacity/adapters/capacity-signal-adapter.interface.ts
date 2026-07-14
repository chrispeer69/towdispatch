/**
 * CapacitySignalAdapter — the outbound formatting seam for capacity
 * broadcasts, following the MotorClubProvider pattern (descriptor +
 * narrow operation surface).
 *
 * The delivery worker owns transport concerns (retries, receipts, SSRF
 * checks, signing); the adapter owns only WHAT goes on the wire for a
 * given partner network. Today every network ships the generic signed
 * JSON payload — no motor club accepts capacity pushes yet — so the
 * registry resolves everything to GenericWebhookAdapter. The agero/nsd/
 * urgently stubs bound the future work of speaking each network's native
 * capacity format once those APIs exist.
 */
import type { CapacityNetworkCode, CapacityPayload } from '@ustowdispatch/shared';
import type { ProviderDescriptor } from '../../../integrations/types.js';

export interface CapacitySignalRequest {
  /** Raw JSON body to POST (already serialized — this exact string is signed). */
  rawBody: string;
  /** Extra headers beyond the signature/delivery-id set the worker adds. */
  headers: Record<string, string>;
}

export interface CapacitySignalAdapter {
  readonly descriptor: ProviderDescriptor;
  /** Networks this adapter formats for. */
  readonly networks: readonly CapacityNetworkCode[];
  /** Shape the on-the-wire request for one partner delivery. */
  buildRequest(payload: CapacityPayload): CapacitySignalRequest;
}
