/**
 * GenericWebhookAdapter — the live v1 capacity-signal format: the shared
 * CapacityPayload contract (schema_version 1.0) as signed JSON. Every
 * network code resolves here until a network-specific adapter lands.
 */
import { Injectable } from '@nestjs/common';
import type { CapacityNetworkCode, CapacityPayload } from '@ustowdispatch/shared';
import { CAPACITY_NETWORK_CODES } from '@ustowdispatch/shared';
import type { ProviderDescriptor } from '../../../integrations/types.js';
import type {
  CapacitySignalAdapter,
  CapacitySignalRequest,
} from './capacity-signal-adapter.interface.js';

@Injectable()
export class GenericWebhookAdapter implements CapacitySignalAdapter {
  readonly descriptor: ProviderDescriptor = {
    id: 'capacity-generic-webhook',
    displayName: 'Generic signed JSON webhook',
    vendor: 'generic',
    capabilities: ['capacity_out'],
  };
  readonly networks: readonly CapacityNetworkCode[] = CAPACITY_NETWORK_CODES;

  buildRequest(payload: CapacityPayload): CapacitySignalRequest {
    return {
      rawBody: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    };
  }
}
