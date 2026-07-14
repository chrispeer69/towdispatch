/**
 * Resolves a partner's network code to the adapter that formats its
 * capacity signal. Deliberately NOT the global IntegrationRegistry: the
 * category list there is a shared contract, and today every network code
 * resolves to the generic adapter anyway — this stays a one-line flip per
 * network once native capacity-ingest APIs exist (see network-stubs.ts).
 */
import { Injectable } from '@nestjs/common';
import type { CapacityNetworkCode } from '@ustowdispatch/shared';
import type { CapacitySignalAdapter } from './capacity-signal-adapter.interface.js';
import { GenericWebhookAdapter } from './generic-webhook.adapter.js';

@Injectable()
export class CapacityAdapterRegistry {
  constructor(private readonly generic: GenericWebhookAdapter) {}

  resolve(_networkCode: CapacityNetworkCode | string): CapacitySignalAdapter {
    // v1: every network ships the generic signed JSON format. When e.g.
    // Agero lands a capacity API: `if (networkCode === 'agero') return this.agero;`
    return this.generic;
  }
}
