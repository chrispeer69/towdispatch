/**
 * Network-specific capacity-signal adapter STUBS — deliberately empty.
 *
 * No motor club accepts inbound capacity pushes today (2026). When Agero /
 * NSD / Urgently publish a capacity-ingest API, implement buildRequest with
 * that network's native format and flip the registry in
 * capacity-adapter.registry.ts to resolve the network code here instead of
 * GenericWebhookAdapter. Until then these throw so nothing silently ships
 * a half-imagined format to a partner.
 */
import { Injectable } from '@nestjs/common';
import type { CapacityNetworkCode, CapacityPayload } from '@ustowdispatch/shared';
import type { ProviderDescriptor } from '../../../integrations/types.js';
import type {
  CapacitySignalAdapter,
  CapacitySignalRequest,
} from './capacity-signal-adapter.interface.js';

abstract class NotImplementedAdapter implements CapacitySignalAdapter {
  abstract readonly descriptor: ProviderDescriptor;
  abstract readonly networks: readonly CapacityNetworkCode[];

  buildRequest(_payload: CapacityPayload): CapacitySignalRequest {
    throw new Error(
      `${this.descriptor.id}: network-specific capacity format not implemented — use GenericWebhookAdapter (see network-stubs.ts header)`,
    );
  }
}

/** STUB — Agero has no capacity-ingest API yet. */
@Injectable()
export class AgeroCapacityStubAdapter extends NotImplementedAdapter {
  readonly descriptor: ProviderDescriptor = {
    id: 'capacity-agero-stub',
    displayName: 'Agero capacity signal (stub)',
    vendor: 'agero',
    capabilities: ['capacity_out'],
  };
  readonly networks: readonly CapacityNetworkCode[] = ['agero'];
}

/** STUB — NSD has no capacity-ingest API yet. */
@Injectable()
export class NsdCapacityStubAdapter extends NotImplementedAdapter {
  readonly descriptor: ProviderDescriptor = {
    id: 'capacity-nsd-stub',
    displayName: 'NSD capacity signal (stub)',
    vendor: 'nsd',
    capabilities: ['capacity_out'],
  };
  readonly networks: readonly CapacityNetworkCode[] = ['nsd'];
}

/** STUB — Urgently has no capacity-ingest API yet. */
@Injectable()
export class UrgentlyCapacityStubAdapter extends NotImplementedAdapter {
  readonly descriptor: ProviderDescriptor = {
    id: 'capacity-urgently-stub',
    displayName: 'Urgently capacity signal (stub)',
    vendor: 'urgently',
    capabilities: ['capacity_out'],
  };
  readonly networks: readonly CapacityNetworkCode[] = ['urgently'];
}
