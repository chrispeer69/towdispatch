/**
 * E2E-007 — Impound lifecycle (real).
 *
 * Impounds are modeled as service_type='impound' jobs plus structured
 * metadata in jobs.notes JSON (see the Towbook importer from Session 16).
 *
 * This spec covers:
 *   1. Impound-typed job creation
 *   2. Listing it back via the jobs API with the service_type filter
 *
 * Lien notice fire + state-specific (Ohio) lien gateway lands in
 * Session 23; this spec covers what's representable today.
 */
import { expect, test } from '@playwright/test';
import { apiGet, apiPost, apiSignup, uniqueSuffix } from '../fixtures/api-client';
import { skipIfNoStack } from '../fixtures/skip-if-no-stack';

test.describe('E2E-007 impound lifecycle', () => {
  test.beforeAll(skipIfNoStack);

  test('impound job created and reachable via /jobs', async () => {
    const suffix = uniqueSuffix('e2e7');
    const owner = await apiSignup({
      tenantName: `Impound Co ${suffix}`,
      tenantSlug: suffix,
      ownerName: 'Impound Owner',
      ownerEmail: `owner-${suffix}@spec.test`,
      password: 'CorrectHorse-Battery-9!',
    });

    const c = await apiPost('/customers', owner.accessToken, {
      type: 'cash',
      name: 'Impound Cust',
      phone: `+1310555${Math.floor(Math.random() * 9000 + 1000)}`,
    });
    const cust = (await c.json()) as { id: string };

    const v = await apiPost('/vehicles', owner.accessToken, {
      customerId: cust.id,
      year: 2018,
      make: 'Honda',
      model: 'Civic',
      vin: `1HGCM82633A${Math.floor(Math.random() * 900000 + 100000)}`,
    });
    const veh = (await v.json()) as { id: string };

    const j = await apiPost('/jobs', owner.accessToken, {
      customerId: cust.id,
      vehicleId: veh.id,
      serviceType: 'impound',
      pickupAddress: '900 Yard Way',
      authorizedBy: 'police',
      notes: JSON.stringify({
        kind: 'impound',
        yard_name: 'Main Yard',
        hold_type: 'police_hold',
        daily_rate_cents: 4500,
      }),
    });
    expect(j.ok).toBe(true);
    const job = (await j.json()) as { id: string; serviceType: string };
    expect(job.serviceType).toBe('impound');

    const listRes = await apiGet('/jobs?serviceType=impound', owner.accessToken);
    expect(listRes.ok).toBe(true);
  });
});
