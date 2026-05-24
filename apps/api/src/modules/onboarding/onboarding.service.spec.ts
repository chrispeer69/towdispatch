import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedResponse } from '@ustowdispatch/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import type { AuthService } from '../auth/auth.service.js';
import type { FleetDriversService } from '../fleet/drivers.service.js';
import type { TrucksService } from '../fleet/trucks.service.js';
import type { RateLimiterService } from '../redis/rate-limiter.service.js';
import type { TenantsService } from '../tenants/tenants.service.js';
import type { UserInvitesService } from '../users/user-invites.service.js';
import { ActivationService } from './activation.service.js';
import type { CallerContext } from './caller-context.js';
import type { CaptchaService } from './captcha.service.js';
import {
  type FakeDbState,
  type FakeProgressRow,
  makeFakeDbState,
  makeFakeTenantDb,
} from './fake-tenant-db.test-helper.js';
import { OnboardingService } from './onboarding.service.js';

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const USER = '00000000-0000-0000-0000-0000000000bb';

const ctx: CallerContext = {
  tenantId: TENANT,
  userId: USER,
  role: 'owner',
  requestId: 'req-1',
  ipAddress: '10.0.0.9',
  userAgent: 'spec',
};

function authResponse(): AuthenticatedResponse {
  return {
    status: 'authenticated',
    user: {
      id: USER,
      email: 'owner@acme.test',
      firstName: 'Olive',
      lastName: 'Owner',
      role: 'owner',
      emailVerifiedAt: null,
      mfaEnabled: false,
    },
    tenant: { id: TENANT, slug: 'acme', name: 'Acme Towing', status: 'active' },
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 900,
  };
}

function liveProgress(overrides: Partial<FakeProgressRow> = {}): FakeProgressRow {
  return {
    id: 'p1',
    tenantId: TENANT,
    currentStep: 'verify_email',
    stepsCompleted: ['account'],
    stepData: {},
    tier: 'free',
    completedAt: null,
    deletedAt: null,
    createdBy: USER,
    ...overrides,
  };
}

interface Harness {
  svc: OnboardingService;
  state: FakeDbState;
  auth: { signup: ReturnType<typeof vi.fn> };
  tenants: { updateCurrent: ReturnType<typeof vi.fn> };
  trucks: { create: ReturnType<typeof vi.fn> };
  drivers: { create: ReturnType<typeof vi.fn> };
  invites: { invite: ReturnType<typeof vi.fn> };
  captcha: { assertValid: ReturnType<typeof vi.fn> };
  rateLimiter: { check: ReturnType<typeof vi.fn> };
}

function harness(state: FakeDbState): Harness {
  const db = makeFakeTenantDb(state) as unknown as TenantAwareDb;
  const activation = new ActivationService(db);
  const auth = { signup: vi.fn().mockResolvedValue(authResponse()) };
  const tenants = { updateCurrent: vi.fn().mockResolvedValue({}) };
  const trucks = { create: vi.fn().mockResolvedValue({}) };
  const drivers = { create: vi.fn().mockResolvedValue({}) };
  const invites = { invite: vi.fn().mockResolvedValue({}) };
  const captcha = { assertValid: vi.fn().mockResolvedValue(undefined) };
  const rateLimiter = {
    check: vi.fn().mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 3600 }),
  };
  const svc = new OnboardingService(
    db,
    auth as unknown as AuthService,
    tenants as unknown as TenantsService,
    trucks as unknown as TrucksService,
    drivers as unknown as FleetDriversService,
    invites as unknown as UserInvitesService,
    activation,
    captcha as unknown as CaptchaService,
    rateLimiter as unknown as RateLimiterService,
  );
  return { svc, state, auth, tenants, trucks, drivers, invites, captcha, rateLimiter };
}

describe('OnboardingService.start', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness(makeFakeDbState());
  });

  it('captcha → rate limit → signup → progress + activation', async () => {
    const res = await h.svc.start(
      {
        tenantName: 'Acme Towing',
        tenantSlug: 'acme',
        ownerName: 'Olive Owner',
        ownerEmail: 'owner@acme.test',
        password: 'Sup3rSecret!pw',
        captchaToken: 'cap-123',
      },
      { ipAddress: '10.0.0.9', userAgent: 'spec', requestId: 'req-1' },
    );

    expect(h.captcha.assertValid).toHaveBeenCalledWith('cap-123');
    expect(h.rateLimiter.check).toHaveBeenCalledWith('onboarding:start:ip:10.0.0.9', 5, 3600);
    // captchaToken is stripped before delegating to auth.signup.
    expect(h.auth.signup).toHaveBeenCalledTimes(1);
    expect(h.auth.signup.mock.calls[0]?.[0]).toEqual({
      tenantName: 'Acme Towing',
      tenantSlug: 'acme',
      ownerName: 'Olive Owner',
      ownerEmail: 'owner@acme.test',
      password: 'Sup3rSecret!pw',
    });

    expect(res.status).toBe('authenticated');
    expect(res.accessToken).toBe('access');
    expect(res.onboarding.tier).toBe('free');
    expect(res.onboarding.currentStep).toBe('verify_email');
    const events = res.onboarding.activationEvents.map((e) => e.eventType);
    expect(events).toContain('account_created');
    expect(events).toContain('free_tier_activated');
  });

  it('rejects + skips signup when the IP rate limit is exceeded', async () => {
    h.rateLimiter.check.mockResolvedValue({ allowed: false, count: 6, retryAfterSeconds: 1800 });
    await expect(
      h.svc.start(
        {
          tenantName: 'Acme',
          tenantSlug: 'acme',
          ownerName: 'O O',
          ownerEmail: 'o@acme.test',
          password: 'Sup3rSecret!pw',
        },
        { ipAddress: '10.0.0.9', requestId: 'r' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.auth.signup).not.toHaveBeenCalled();
  });

  it('rejects before rate-limit / signup when captcha fails', async () => {
    h.captcha.assertValid.mockRejectedValue(new ForbiddenException('captcha'));
    await expect(
      h.svc.start(
        {
          tenantName: 'Acme',
          tenantSlug: 'acme',
          ownerName: 'O O',
          ownerEmail: 'o@acme.test',
          password: 'Sup3rSecret!pw',
        },
        { ipAddress: '10.0.0.9', requestId: 'r' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.rateLimiter.check).not.toHaveBeenCalled();
    expect(h.auth.signup).not.toHaveBeenCalled();
  });

  it('uses an "unknown" IP bucket when no IP is present', async () => {
    await h.svc.start(
      {
        tenantName: 'Acme',
        tenantSlug: 'acme',
        ownerName: 'O O',
        ownerEmail: 'o@acme.test',
        password: 'Sup3rSecret!pw',
      },
      { requestId: 'r' },
    );
    expect(h.rateLimiter.check).toHaveBeenCalledWith('onboarding:start:ip:unknown', 5, 3600);
  });
});

describe('OnboardingService.getProgress', () => {
  it('creates a progress row on first read and reports the verify step', async () => {
    const h = harness(makeFakeDbState());
    const p = await h.svc.getProgress(ctx);
    expect(p.currentStep).toBe('verify_email');
    expect(p.stepsCompleted).toContain('account');
    expect(h.state.progressRow).not.toBeNull();
  });

  it('advances the resume step to company_info once email is verified', async () => {
    const h = harness(
      makeFakeDbState({
        progressRow: liveProgress(),
        counts: { verifiedUsers: 1, trucks: 0, drivers: 0, invites: 0, dispatchedJobs: 0 },
      }),
    );
    const p = await h.svc.getProgress(ctx);
    expect(p.checklist.emailVerified).toBe(true);
    expect(p.currentStep).toBe('company_info');
    expect(h.state.progressRow?.currentStep).toBe('company_info');
  });

  it('marks completed when everything is done', async () => {
    const h = harness(
      makeFakeDbState({
        progressRow: liveProgress({ completedAt: new Date() }),
        counts: { verifiedUsers: 1, trucks: 1, drivers: 1, invites: 1, dispatchedJobs: 1 },
      }),
    );
    const p = await h.svc.getProgress(ctx);
    expect(p.currentStep).toBe('completed');
    expect(p.completedAt).not.toBeNull();
  });
});

describe('OnboardingService wizard steps', () => {
  it('submitCompanyInfo updates tenant name + persists step data', async () => {
    const h = harness(makeFakeDbState({ progressRow: liveProgress() }));
    const p = await h.svc.submitCompanyInfo(ctx, {
      legalName: 'Acme Towing LLC',
      timezone: 'America/New_York',
      addressLine1: '1 Main St',
      city: 'Columbus',
      state: 'OH',
      postalCode: '43004',
    });
    expect(h.tenants.updateCurrent).toHaveBeenCalledWith(ctx, { name: 'Acme Towing LLC' });
    expect(p.stepsCompleted).toContain('company_info');
    expect((p.stepData.companyInfo as { legalName: string }).legalName).toBe('Acme Towing LLC');
    expect(p.checklist.companyInfoCompleted).toBe(true);
  });

  it('submitFirstUser invites a teammate through the invite flow', async () => {
    const h = harness(makeFakeDbState({ progressRow: liveProgress() }));
    await h.svc.submitFirstUser(ctx, {
      email: 'tech@acme.test',
      fullName: 'Tech One',
      role: 'dispatcher',
    });
    expect(h.invites.invite).toHaveBeenCalledTimes(1);
    expect(h.invites.invite.mock.calls[0]?.[1]).toMatchObject({
      email: 'tech@acme.test',
      role: 'dispatcher',
      fullName: 'Tech One',
    });
    expect(h.state.progressRow?.stepsCompleted).toContain('first_user');
  });

  it('submitFirstTruck creates the truck when under the free-tier cap', async () => {
    const h = harness(
      makeFakeDbState({
        progressRow: liveProgress(),
        counts: { verifiedUsers: 0, trucks: 0, drivers: 0, invites: 0, dispatchedJobs: 0 },
      }),
    );
    const p = await h.svc.submitFirstTruck(ctx, { unitNumber: 'T-1', truckType: 'flatbed' });
    expect(h.trucks.create).toHaveBeenCalledTimes(1);
    expect(h.trucks.create.mock.calls[0]?.[1]).toMatchObject({
      unitNumber: 'T-1',
      truckType: 'flatbed',
      status: 'active',
    });
    expect(p.stepsCompleted).toContain('first_truck');
  });

  it('submitFirstTruck rejects at the free-tier cap without creating', async () => {
    const h = harness(
      makeFakeDbState({
        progressRow: liveProgress(),
        counts: { verifiedUsers: 0, trucks: 2, drivers: 0, invites: 0, dispatchedJobs: 0 },
      }),
    );
    await expect(
      h.svc.submitFirstTruck(ctx, { unitNumber: 'T-3', truckType: 'flatbed' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.trucks.create).not.toHaveBeenCalled();
  });

  it('submitFirstDriver creates the driver when under cap', async () => {
    const h = harness(makeFakeDbState({ progressRow: liveProgress() }));
    const p = await h.svc.submitFirstDriver(ctx, { firstName: 'Dana', lastName: 'Driver' });
    expect(h.drivers.create).toHaveBeenCalledTimes(1);
    expect(h.drivers.create.mock.calls[0]?.[1]).toMatchObject({
      firstName: 'Dana',
      lastName: 'Driver',
    });
    expect(p.stepsCompleted).toContain('first_driver');
  });

  it('submitFirstDriver rejects at the free-tier cap without creating', async () => {
    const h = harness(
      makeFakeDbState({
        progressRow: liveProgress(),
        counts: { verifiedUsers: 0, trucks: 0, drivers: 2, invites: 0, dispatchedJobs: 0 },
      }),
    );
    await expect(
      h.svc.submitFirstDriver(ctx, { firstName: 'Extra', lastName: 'Driver' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.drivers.create).not.toHaveBeenCalled();
  });

  it('skipStep marks the step complete without side effects', async () => {
    const h = harness(makeFakeDbState({ progressRow: liveProgress() }));
    await h.svc.skipStep(ctx, 'company_info');
    expect(h.tenants.updateCurrent).not.toHaveBeenCalled();
    expect(h.state.progressRow?.stepsCompleted).toContain('company_info');
  });

  it('complete finalizes the wizard and emits onboarding_completed', async () => {
    const h = harness(makeFakeDbState({ progressRow: liveProgress() }));
    const p = await h.svc.complete(ctx);
    expect(p.currentStep).toBe('completed');
    expect(p.completedAt).not.toBeNull();
    expect(h.state.events.map((e) => e.eventType)).toContain('onboarding_completed');
  });
});
