// Phase 2 implementations: CONVINI (auto repair + body + rental — Blue Collar AI ecosystem brand)
// Future: 3rd-party body shop networks (CARSTAR, Maaco) and rental fleets (Enterprise, Hertz)
// CONVINI provides preferred rates within Blue Collar AI ecosystem, reducing claim severity for insurance partners
// (See Marc Arbaugh / Kapnick partnership materials)
//
// This file is the contract surface only — no implementations live here. A
// connected-provider class lands in apps/api/src/integrations/ecosystem/<vendor>/
// in Phase 2 and registers itself with the IntegrationRegistry under the
// 'ecosystem' category. Until then, no provider is connected and the
// EcosystemRefer* APIs that depend on this interface remain dormant.

import type { IntegrationProvider } from '../types.js';

export interface EcosystemPartnerCredentials {
  /** Vendor-specific configuration. Opaque to TowCommand core. */
  config: Record<string, unknown>;
}

/**
 * The kind of service a partner can fulfill. We start narrow — auto-repair,
 * body work, rental — because that's what the post-tow flow needs. Add new
 * referral kinds here as Blue Collar AI ecosystem expands (glass, paint,
 * detailing, towing-from-other-tenant, etc.).
 */
export const ECOSYSTEM_REFERRAL_KINDS = ['auto_repair', 'body_work', 'rental_car'] as const;
export type EcosystemReferralKind = (typeof ECOSYSTEM_REFERRAL_KINDS)[number];

export interface EcosystemReferralInput {
  /** Internal customer id (tenant-scoped). Opaque to the partner. */
  customerId: string;
  /** Free-text contact info — the partner reaches out via this. */
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  /** Vehicle details when available — partners use this to scope estimates. */
  vehicle?: {
    vin?: string;
    year?: number;
    make?: string;
    model?: string;
    plate?: string;
    plateState?: string;
  };
  /** Optional pickup/dropoff coordinates so the partner can route a tow if needed. */
  location?: { lat: number; lng: number; address?: string };
  /** Free-text notes from the dispatcher. */
  notes?: string;
}

export interface EcosystemReferralReceipt {
  /** Vendor-side referral id; we persist it for webhook reconciliation. */
  externalReferralId: string;
  /** Raw status the partner returned at handoff time. */
  status: 'pending' | 'accepted' | 'rejected';
  /** Vendor-supplied URL where the customer continues the flow, if any. */
  customerHandoffUrl?: string;
  /** Vendor's promised SLA in hours — null when no SLA was given. */
  slaHours?: number;
  receivedAt: string;
}

/**
 * Webhook payload an EcosystemPartner sends back when the referred customer
 * completes a service. The partner is responsible for signing the request;
 * implementations validate and surface a normalized event to TowCommand.
 */
export interface EcosystemServiceCompletedEvent {
  externalReferralId: string;
  kind: EcosystemReferralKind;
  completedAt: string;
  /** Cents in the tenant's currency. Set when the partner reports billing. */
  amountCents?: number;
  currency?: string;
  /** Free-text summary from the partner ("brake job, $812"). */
  summary?: string;
  /** Vendor-supplied opaque payload for audit. */
  raw?: Record<string, unknown>;
}

/**
 * EcosystemPartner — a referral target that can take a customer off
 * TowCommand's hands for a downstream service (repair, body, rental). Each
 * implementation declares which referral kinds it supports via descriptor
 * capabilities (e.g. ['auto_repair','body_work']).
 *
 * Implementations:
 *   - referAutoRepair / referBodyWork / referRentalCar: synchronous handoff,
 *     returns a receipt. Failure throws — the caller decides whether to fall
 *     back to a different partner.
 *   - parseServiceCompletedWebhook: invoked from a tenant-scoped webhook
 *     route handler with the raw HTTP payload + signature; returns the
 *     normalized event or throws on signature/format failures.
 */
export interface EcosystemPartner extends IntegrationProvider {
  referAutoRepair(
    creds: EcosystemPartnerCredentials,
    input: EcosystemReferralInput,
  ): Promise<EcosystemReferralReceipt>;
  referBodyWork(
    creds: EcosystemPartnerCredentials,
    input: EcosystemReferralInput,
  ): Promise<EcosystemReferralReceipt>;
  referRentalCar(
    creds: EcosystemPartnerCredentials,
    input: EcosystemReferralInput,
  ): Promise<EcosystemReferralReceipt>;
  parseServiceCompletedWebhook(
    creds: EcosystemPartnerCredentials,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<EcosystemServiceCompletedEvent>;
}
