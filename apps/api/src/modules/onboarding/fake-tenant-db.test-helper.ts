/**
 * In-memory fake of TenantAwareDb for onboarding unit tests.
 *
 * Drizzle's fluent builders are mocked just deeply enough to cover the exact
 * call chains OnboardingService / ActivationService make:
 *   - insert(t).values(v).onConflictDoNothing(opts?)[.returning()]
 *   - query.onboardingProgress.findFirst / query.tenantActivationEvents.findMany
 *   - select(sel).from(t).where(...)   (also awaited without .where())
 *   - update(t).set(v).where(...)
 *
 * Tables are matched by reference equality against the real schema objects, so
 * the counts/rows a test programs map to the right query. The activation-event
 * insert honors the (tenant, event_type) uniqueness so refresh is idempotent,
 * mirroring the DB unique index.
 */
import {
  drivers,
  jobs,
  onboardingProgress,
  tenantActivationEvents,
  trucks,
  userInvites,
  users,
} from '@ustowdispatch/db';
import type { TenantContextValues } from '../../database/tenant-aware-db.service.js';

export interface FakeActivationEvent {
  eventType: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

export interface FakeProgressRow {
  id: string;
  tenantId: string;
  currentStep: string;
  stepsCompleted: string[];
  stepData: Record<string, unknown>;
  tier: 'free' | 'starter' | 'pro';
  completedAt: Date | null;
  deletedAt: Date | null;
  createdBy: string | null;
}

export interface FakeDbState {
  progressRow: FakeProgressRow | null;
  /** Per-table row counts returned by select({ n: count() }). */
  counts: {
    verifiedUsers: number;
    trucks: number;
    drivers: number;
    invites: number;
    dispatchedJobs: number;
  };
  events: FakeActivationEvent[];
  /** Records the tenant contexts runInTenantContext was invoked with. */
  contexts: TenantContextValues[];
}

export function makeFakeDbState(overrides: Partial<FakeDbState> = {}): FakeDbState {
  return {
    progressRow: null,
    counts: { verifiedUsers: 0, trucks: 0, drivers: 0, invites: 0, dispatchedJobs: 0 },
    events: [],
    contexts: [],
    ...overrides,
  };
}

function countForTable(state: FakeDbState, table: unknown): number {
  if (table === users) return state.counts.verifiedUsers;
  if (table === trucks) return state.counts.trucks;
  if (table === drivers) return state.counts.drivers;
  if (table === userInvites) return state.counts.invites;
  if (table === jobs) return state.counts.dispatchedJobs;
  return 0;
}

class SelectBuilder implements PromiseLike<Array<{ n: number }>> {
  private table: unknown = null;
  constructor(private readonly state: FakeDbState) {}
  from(table: unknown): this {
    this.table = table;
    return this;
  }
  where(): this {
    return this;
  }
  // biome-ignore lint/suspicious/noThenProperty: fake drizzle query builder is intentionally awaitable
  then<TResult1 = Array<{ n: number }>, TResult2 = never>(
    onfulfilled?: ((value: Array<{ n: number }>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve([{ n: countForTable(this.state, this.table) }]).then(
      onfulfilled,
      onrejected,
    );
  }
}

class InsertBuilder implements PromiseLike<undefined> {
  private row: Record<string, unknown> = {};
  constructor(
    private readonly state: FakeDbState,
    private readonly table: unknown,
  ) {}
  values(v: Record<string, unknown>): this {
    this.row = v;
    if (this.table === tenantActivationEvents) {
      const eventType = String(v.eventType);
      const exists = this.state.events.some((e) => e.eventType === eventType);
      if (!exists) {
        this.state.events.push({
          eventType,
          occurredAt: new Date(),
          metadata: (v.metadata as Record<string, unknown>) ?? {},
        });
      }
    }
    return this;
  }
  onConflictDoNothing(): this {
    return this;
  }
  returning(): Promise<FakeProgressRow[]> {
    if (this.table === onboardingProgress) {
      const created: FakeProgressRow = {
        id: String(this.row.id ?? 'fake-id'),
        tenantId: String(this.row.tenantId),
        currentStep: String(this.row.currentStep ?? 'verify_email'),
        stepsCompleted: (this.row.stepsCompleted as string[]) ?? ['account'],
        stepData: (this.row.stepData as Record<string, unknown>) ?? {},
        tier: (this.row.tier as 'free' | 'starter' | 'pro') ?? 'free',
        completedAt: null,
        deletedAt: null,
        createdBy: (this.row.createdBy as string) ?? null,
      };
      this.state.progressRow = created;
      return Promise.resolve([created]);
    }
    return Promise.resolve([]);
  }
  // biome-ignore lint/suspicious/noThenProperty: fake drizzle query builder is intentionally awaitable
  then<TResult1 = undefined, TResult2 = never>(
    onfulfilled?: ((value: undefined) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(undefined).then(onfulfilled, onrejected);
  }
}

class UpdateBuilder implements PromiseLike<undefined> {
  private patch: Record<string, unknown> = {};
  constructor(
    private readonly state: FakeDbState,
    private readonly table: unknown,
  ) {}
  set(v: Record<string, unknown>): this {
    this.patch = v;
    return this;
  }
  where(): this {
    if (this.table === onboardingProgress && this.state.progressRow) {
      this.state.progressRow = { ...this.state.progressRow, ...this.patch } as FakeProgressRow;
    }
    return this;
  }
  // biome-ignore lint/suspicious/noThenProperty: fake drizzle query builder is intentionally awaitable
  then<TResult1 = undefined, TResult2 = never>(
    onfulfilled?: ((value: undefined) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(undefined).then(onfulfilled, onrejected);
  }
}

function makeTx(state: FakeDbState): unknown {
  return {
    insert: (table: unknown) => new InsertBuilder(state, table),
    update: (table: unknown) => new UpdateBuilder(state, table),
    select: () => new SelectBuilder(state),
    query: {
      onboardingProgress: {
        findFirst: async () => state.progressRow ?? undefined,
      },
      tenantActivationEvents: {
        findMany: async () =>
          state.events.map((e) => ({
            eventType: e.eventType,
            occurredAt: e.occurredAt,
            metadata: e.metadata,
          })),
      },
    },
  };
}

/** Builds a TenantAwareDb-compatible fake bound to the given state. */
export function makeFakeTenantDb(state: FakeDbState): {
  runInTenantContext: <T>(ctx: TenantContextValues, work: (tx: never) => Promise<T>) => Promise<T>;
} {
  return {
    runInTenantContext: async <T>(
      ctx: TenantContextValues,
      work: (tx: never) => Promise<T>,
    ): Promise<T> => {
      state.contexts.push(ctx);
      return work(makeTx(state) as never);
    },
  };
}
