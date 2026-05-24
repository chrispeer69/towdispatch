import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingController } from './onboarding.controller.js';
import type { OnboardingService } from './onboarding.service.js';

function req(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    requestContext: {
      requestId: 'req-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'owner',
      ipAddress: '10.0.0.1',
      userAgent: 'spec',
      ...overrides,
    },
  } as unknown as FastifyRequest;
}

function build(): { ctrl: OnboardingController; svc: Record<string, ReturnType<typeof vi.fn>> } {
  const svc = {
    start: vi.fn().mockResolvedValue({ status: 'authenticated' }),
    getProgress: vi.fn().mockResolvedValue({ currentStep: 'verify_email' }),
    submitCompanyInfo: vi.fn().mockResolvedValue({}),
    submitFirstUser: vi.fn().mockResolvedValue({}),
    submitFirstTruck: vi.fn().mockResolvedValue({}),
    submitFirstDriver: vi.fn().mockResolvedValue({}),
    skipStep: vi.fn().mockResolvedValue({}),
    complete: vi.fn().mockResolvedValue({}),
  };
  return { ctrl: new OnboardingController(svc as unknown as OnboardingService), svc };
}

describe('OnboardingController', () => {
  it('start passes the body + request meta', async () => {
    const { ctrl, svc } = build();
    const body = {
      tenantName: 'Acme',
      tenantSlug: 'acme',
      ownerName: 'O O',
      ownerEmail: 'o@acme.test',
      password: 'pw',
    };
    await ctrl.start(body as never, req());
    expect(svc.start).toHaveBeenCalledWith(body, {
      ipAddress: '10.0.0.1',
      userAgent: 'spec',
      requestId: 'req-1',
    });
  });

  it('progress builds a caller context from the request', async () => {
    const { ctrl, svc } = build();
    await ctrl.progress(req());
    expect(svc.getProgress).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'owner',
      requestId: 'req-1',
      ipAddress: '10.0.0.1',
      userAgent: 'spec',
    });
  });

  it('step handlers delegate with ctx + body', async () => {
    const { ctrl, svc } = build();
    await ctrl.companyInfo({ legalName: 'X' } as never, req());
    await ctrl.firstUser({ email: 'a@b.test' } as never, req());
    await ctrl.firstTruck({ unitNumber: 'T-1' } as never, req());
    await ctrl.firstDriver({ firstName: 'D', lastName: 'D' } as never, req());
    await ctrl.skip({ step: 'company_info' } as never, req());
    await ctrl.complete(req());
    expect(svc.submitCompanyInfo).toHaveBeenCalledTimes(1);
    expect(svc.submitFirstUser).toHaveBeenCalledTimes(1);
    expect(svc.submitFirstTruck).toHaveBeenCalledTimes(1);
    expect(svc.submitFirstDriver).toHaveBeenCalledTimes(1);
    expect(svc.skipStep).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'company_info',
    );
    expect(svc.complete).toHaveBeenCalledTimes(1);
  });
});
