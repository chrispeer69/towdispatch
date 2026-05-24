'use server';

/**
 * Server actions for the onboarding wizard. Each one composes EXISTING backend
 * endpoints (tenants / users / fleet) for the real entity creation, then calls
 * the onboarding step endpoint to record resumable progress. No new BFF route
 * handlers are introduced — server actions may write cookies, so apiServerBff
 * (refresh-on-401) is safe here. See SESSION_25_DECISIONS.md D7.
 */
import { apiServerBff } from '@/lib/api/client';
import type { ActionResult } from './types';

function toMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}

export interface CompanyInfoInput {
  name: string;
  timezone?: string | undefined;
}

export async function saveCompanyInfo(input: CompanyInfoInput): Promise<ActionResult> {
  try {
    const body: { name: string; settings?: { timezone: string } } = { name: input.name };
    if (input.timezone) body.settings = { timezone: input.timezone };
    await apiServerBff('/tenants/current', { method: 'PATCH', body });
    await apiServerBff('/onboarding/steps/company_info', {
      method: 'PATCH',
      body: { data: input, complete: true },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export interface InviteUserInput {
  email: string;
  role: string;
  fullName?: string | undefined;
}

export async function inviteFirstUser(input: InviteUserInput): Promise<ActionResult> {
  try {
    const body: { email: string; role: string; fullName?: string } = {
      email: input.email,
      role: input.role,
    };
    if (input.fullName) body.fullName = input.fullName;
    await apiServerBff('/users/invite', { method: 'POST', body });
    await apiServerBff('/onboarding/steps/first_user', {
      method: 'PATCH',
      body: { data: { email: input.email, role: input.role }, complete: true },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export interface TruckInput {
  unitNumber: string;
  make?: string | undefined;
  model?: string | undefined;
}

export async function addFirstTruck(input: TruckInput): Promise<ActionResult> {
  try {
    const body: TruckInput = { unitNumber: input.unitNumber };
    if (input.make) body.make = input.make;
    if (input.model) body.model = input.model;
    await apiServerBff('/fleet/trucks', { method: 'POST', body });
    await apiServerBff('/onboarding/steps/first_truck', {
      method: 'PATCH',
      body: { data: input, complete: true },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export interface DriverInput {
  firstName: string;
  lastName: string;
  phone?: string | undefined;
}

export async function addFirstDriver(input: DriverInput): Promise<ActionResult> {
  try {
    const body: DriverInput = { firstName: input.firstName, lastName: input.lastName };
    if (input.phone) body.phone = input.phone;
    await apiServerBff('/fleet/drivers', { method: 'POST', body });
    await apiServerBff('/onboarding/steps/first_driver', {
      method: 'PATCH',
      body: { data: input, complete: true },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

/** Skip an optional step — records it complete with an empty snapshot. */
export async function skipStep(
  step: 'first_user' | 'first_truck' | 'first_driver',
): Promise<ActionResult> {
  try {
    await apiServerBff(`/onboarding/steps/${step}`, {
      method: 'PATCH',
      body: { data: {}, complete: true },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function activateFreeTier(): Promise<ActionResult> {
  try {
    await apiServerBff('/onboarding/activate', { method: 'POST', body: { tier: 'free' } });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function completeOnboarding(): Promise<ActionResult> {
  try {
    await apiServerBff('/onboarding/complete', { method: 'POST', body: {} });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
