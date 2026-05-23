/**
 * In-memory fakes for the tier-offer service/cron unit tests. No Postgres,
 * no Nest container — the repository is replaced by a Map-backed double and
 * the two transaction runners just invoke the work function with a stub
 * handle. This lets us assert the service-layer state-machine logic in
 * isolation; real RLS / tenant-isolation is proven by the gated integration
 * spec apps/api/test/tier-offer-composer-rls.spec.ts (Session 1).
 */
import type { TierOffer, TierOfferRecipient } from '@ustowdispatch/db';
import type { ConfigService } from '../../src/config/config.service.js';
import type { TenantAwareDb } from '../../src/database/tenant-aware-db.service.js';
import type { TransactionRunner } from '../../src/database/transaction-runner.service.js';
import type { TierOfferRepository } from '../../src/modules/tier-offers/tier-offer.repository.js';

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `0192f8c0-0000-7000-8000-${counter.toString(16).padStart(12, '0')}`;
};

export function makeOffer(overrides: Partial<TierOffer> = {}): TierOffer {
  const now = new Date('2026-05-23T12:00:00.000Z');
  return {
    id: overrides.id ?? nextId(),
    tenantId: overrides.tenantId ?? 'tenant-1',
    tierId: overrides.tierId ?? 'tier-1',
    composedBy: overrides.composedBy ?? 'user-1',
    title: overrides.title ?? 'Storm Surge — Memorial Day',
    subjectLine: overrides.subjectLine ?? 'Elevated rate offer',
    narrative: overrides.narrative ?? 'We are committing trucks for the holiday window.',
    eventWindowStart: overrides.eventWindowStart ?? new Date('2026-05-25T00:00:00.000Z'),
    eventWindowEnd: overrides.eventWindowEnd ?? new Date('2026-05-26T00:00:00.000Z'),
    committedTruckCount: overrides.committedTruckCount ?? 3,
    acceptanceDeadlineAt: overrides.acceptanceDeadlineAt ?? new Date('2026-05-24T00:00:00.000Z'),
    defaultForNonResponders: overrides.defaultForNonResponders ?? 'opt_out',
    status: overrides.status ?? 'draft',
    sentAt: overrides.sentAt ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
    cancelledReason: overrides.cancelledReason ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt ?? null,
  };
}

export function makeRecipient(overrides: Partial<TierOfferRecipient> = {}): TierOfferRecipient {
  const now = new Date('2026-05-23T12:00:00.000Z');
  return {
    id: overrides.id ?? nextId(),
    tenantId: overrides.tenantId ?? 'tenant-1',
    offerId: overrides.offerId ?? 'offer-1',
    accountId: overrides.accountId ?? null,
    recipientName: overrides.recipientName ?? 'Jane Manager',
    recipientRole: overrides.recipientRole ?? null,
    recipientEmail: overrides.recipientEmail ?? 'jane@motorclub.example',
    recipientPhone: overrides.recipientPhone ?? null,
    magicLinkToken: overrides.magicLinkToken ?? `tok-${nextId()}`,
    magicLinkExpiresAt: overrides.magicLinkExpiresAt ?? new Date('2026-06-07T00:00:00.000Z'),
    status: overrides.status ?? 'pending_send',
    emailSentAt: overrides.emailSentAt ?? null,
    emailDeliveredAt: overrides.emailDeliveredAt ?? null,
    emailOpenedAt: overrides.emailOpenedAt ?? null,
    respondedAt: overrides.respondedAt ?? null,
    responseIp: overrides.responseIp ?? null,
    responseUserAgent: overrides.responseUserAgent ?? null,
    declineReason: overrides.declineReason ?? null,
    notes: overrides.notes ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt ?? null,
  };
}

/**
 * Map-backed TierOfferRepository double. Implements every method the
 * services call; the `tx` arg is ignored (no real DB).
 */
export class FakeTierOfferRepository {
  readonly offers = new Map<string, TierOffer>();
  readonly recipients = new Map<string, TierOfferRecipient>();

  seedOffer(offer: TierOffer): TierOffer {
    this.offers.set(offer.id, offer);
    return offer;
  }

  seedRecipient(recipient: TierOfferRecipient): TierOfferRecipient {
    this.recipients.set(recipient.id, recipient);
    return recipient;
  }

  async listOffers(): Promise<TierOffer[]> {
    return [...this.offers.values()].filter((o) => o.deletedAt === null);
  }

  async findOffer(_tx: unknown, offerId: string): Promise<TierOffer | undefined> {
    const o = this.offers.get(offerId);
    return o && o.deletedAt === null ? o : undefined;
  }

  async insertOffer(_tx: unknown, values: Partial<TierOffer>): Promise<TierOffer> {
    // Emulate the DB defaulting created_at / updated_at (and other
    // NOT NULL DEFAULT columns) that the service does not supply on insert,
    // then returns via .returning().
    const row = makeOffer(values);
    this.offers.set(row.id, row);
    return row;
  }

  async updateOffer(
    _tx: unknown,
    offerId: string,
    patch: Partial<TierOffer>,
  ): Promise<TierOffer | undefined> {
    const existing = this.offers.get(offerId);
    if (!existing || existing.deletedAt !== null) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date() } as TierOffer;
    this.offers.set(offerId, updated);
    return updated;
  }

  async softDeleteOffer(_tx: unknown, offerId: string): Promise<void> {
    const existing = this.offers.get(offerId);
    if (existing) this.offers.set(offerId, { ...existing, deletedAt: new Date() });
  }

  async listRecipientsForOffer(_tx: unknown, offerId: string): Promise<TierOfferRecipient[]> {
    return [...this.recipients.values()].filter(
      (r) => r.offerId === offerId && r.deletedAt === null,
    );
  }

  async findRecipient(_tx: unknown, recipientId: string): Promise<TierOfferRecipient | undefined> {
    const r = this.recipients.get(recipientId);
    return r && r.deletedAt === null ? r : undefined;
  }

  async insertRecipient(
    _tx: unknown,
    values: Partial<TierOfferRecipient>,
  ): Promise<TierOfferRecipient> {
    const row = makeRecipient(values);
    this.recipients.set(row.id, row);
    return row;
  }

  async updateRecipient(
    _tx: unknown,
    recipientId: string,
    patch: Partial<TierOfferRecipient>,
  ): Promise<TierOfferRecipient | undefined> {
    const existing = this.recipients.get(recipientId);
    if (!existing || existing.deletedAt !== null) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date() } as TierOfferRecipient;
    this.recipients.set(recipientId, updated);
    return updated;
  }

  async findExpirableRecipients(_tx: unknown, now: Date): Promise<TierOfferRecipient[]> {
    return [...this.recipients.values()].filter(
      (r) =>
        r.deletedAt === null &&
        ['sent', 'delivered', 'opened'].includes(r.status) &&
        r.magicLinkExpiresAt.getTime() <= now.getTime(),
    );
  }

  async listRecipientsForOfferByStatus(
    _tx: unknown,
    offerId: string,
    statuses: TierOfferRecipient['status'][],
  ): Promise<TierOfferRecipient[]> {
    return [...this.recipients.values()].filter(
      (r) => r.offerId === offerId && r.deletedAt === null && statuses.includes(r.status),
    );
  }

  asRepo(): TierOfferRepository {
    return this as unknown as TierOfferRepository;
  }
}

/**
 * Stub TenantAwareDb. runInTenantContext just invokes work() with a fake
 * `tx` that exposes the few direct `tx.query.*` lookups the services make
 * outside the repository (tier existence check, tenant name).
 */
export class FakeTenantAwareDb {
  seededTier: { id: string; deletedAt: Date | null } | null = { id: 'tier-1', deletedAt: null };
  seededTenant: { id: string; name: string } | null = { id: 'tenant-1', name: 'Acme Towing' };

  // biome-ignore lint/suspicious/noExplicitAny: test double for an opaque tx handle
  private get tx(): any {
    return {
      query: {
        dynamicPricingTiers: {
          findFirst: async () => this.seededTier ?? undefined,
        },
        tenants: {
          findFirst: async () => this.seededTenant ?? undefined,
        },
      },
    };
  }

  async runInTenantContext<T>(_ctx: unknown, work: (tx: unknown) => Promise<T>): Promise<T> {
    return work(this.tx);
  }

  asDb(): TenantAwareDb {
    return this as unknown as TenantAwareDb;
  }
}

/**
 * Stub TransactionRunner (admin pool). `runAsAdmin` invokes work() with a
 * fake admin handle. `tenants.findMany` returns the seeded tenant list (for
 * the cron); `tierOfferRecipients.findFirst` returns the single recipient
 * whose token matches (for public-token resolution) — the recipients store
 * is shared with the FakeRepo so token resolution sees the same rows.
 */
export class FakeTransactionRunner {
  seededTenants: { id: string }[] = [{ id: 'tenant-1' }];

  constructor(private readonly repo?: FakeTierOfferRepository) {}

  // biome-ignore lint/suspicious/noExplicitAny: test double for an opaque admin tx handle
  private adminTx(): any {
    const repo = this.repo;
    return {
      query: {
        tenants: {
          findMany: async () => this.seededTenants,
        },
        tierOfferRecipients: {
          // The real query filters by id AND token AND deletedAt IS NULL.
          // The fake can't read the drizzle where-expression, so it scans
          // the shared store and returns the first live recipient that
          // carries a magic-link token. Tests seed exactly the recipient a
          // token targets, so this resolves unambiguously.
          findFirst: async () => {
            if (!repo) return undefined;
            return [...repo.recipients.values()].find((r) => r.deletedAt === null);
          },
        },
      },
    };
  }

  async runAsAdmin<T>(_ctx: unknown, work: (tx: unknown) => Promise<T>): Promise<T> {
    return work(this.adminTx());
  }

  asRunner(): TransactionRunner {
    return this as unknown as TransactionRunner;
  }
}

/** Stub ConfigService exposing just the tierOffers accessor. */
export function fakeConfig(opts?: {
  cronEnabled?: boolean;
  secret?: string;
  ttlDays?: number;
}): ConfigService {
  return {
    tierOffers: {
      cronEnabled: opts?.cronEnabled ?? false,
      magicLinkSecret: opts?.secret ?? 'test-secret-32-chars-minimum-aaaaaaaaaa',
      magicLinkTtlDays: opts?.ttlDays ?? 14,
    },
  } as unknown as ConfigService;
}
