/**
 * Provider registry primitives.
 *
 * TowCommand treats every external integration — QuickBooks, Stripe, Agero,
 * a future Blue Collar AI sibling product — as a peer. There is no privileged
 * vendor. Each provider category (accounting, payment, ...) defines a single
 * interface that any number of vendors can implement, and the
 * IntegrationRegistry indexes those implementations by category + provider id.
 *
 * Why a registry instead of NestJS multi-providers: tenants choose at runtime
 * which provider they're paying for, and we resolve the implementation by
 * stable string id (e.g. "quickbooks-online", "stripe") rather than by DI
 * token. That makes it trivial to add a new vendor in a feature module without
 * touching the consumer modules.
 */
import { Injectable } from '@nestjs/common';

export const INTEGRATION_CATEGORIES = [
  'accounting',
  'payment',
  'motor-club',
  'notification',
  'maps',
  'telematics',
  'document-signing',
  // ecosystem partners (auto-repair, body work, rental car referrals).
  // CONVINI lands in Phase 2; the EcosystemPartner interface lives at
  // ./ecosystem/ecosystem-provider.interface.ts.
  'ecosystem',
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  vendor: string;
  capabilities: readonly string[];
}

export interface IntegrationProvider {
  readonly descriptor: ProviderDescriptor;
}

@Injectable()
export class IntegrationRegistry {
  private readonly byCategory = new Map<IntegrationCategory, Map<string, IntegrationProvider>>();

  register(category: IntegrationCategory, provider: IntegrationProvider): void {
    let bucket = this.byCategory.get(category);
    if (!bucket) {
      bucket = new Map();
      this.byCategory.set(category, bucket);
    }
    if (bucket.has(provider.descriptor.id)) {
      throw new Error(`Duplicate provider registration for ${category}: ${provider.descriptor.id}`);
    }
    bucket.set(provider.descriptor.id, provider);
  }

  get<T extends IntegrationProvider>(category: IntegrationCategory, providerId: string): T {
    const provider = this.byCategory.get(category)?.get(providerId);
    if (!provider) {
      throw new Error(`No provider registered for ${category}/${providerId}`);
    }
    return provider as T;
  }

  list(category: IntegrationCategory): ProviderDescriptor[] {
    return Array.from(this.byCategory.get(category)?.values() ?? []).map((p) => p.descriptor);
  }

  has(category: IntegrationCategory, providerId: string): boolean {
    return this.byCategory.get(category)?.has(providerId) ?? false;
  }
}
