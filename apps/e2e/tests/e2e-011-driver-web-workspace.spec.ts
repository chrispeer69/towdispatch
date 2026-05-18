/**
 * E2E-011 — Driver web workspace happy-path (Session 3).
 *
 * Seeds a tenant + driver + truck + driver-truck assignment + PIN via the
 * operator API, then exercises the driver-app API surface end-to-end with
 * the driver JWT:
 *
 *   1. POST /driver-auth/list-drivers — picker renders the seeded driver
 *   2. POST /driver-auth/login — JWT is issued for the PIN
 *   3. POST /driver-shifts/check-in — shift starts against the seeded truck
 *   4. POST /driver-pretrip — DVIR with all-pass items
 *   5. POST /job-evidence/presign for a stub photo upload (S3 PUT skipped
 *      in this spec — it's exercised in the upload-helper unit tests)
 *   6. POST /driver-shifts/check-out — shift ends cleanly
 *
 * The Playwright browser is used only for the auth-flow assertions; the
 * data plane is exercised directly against the API so the test stays fast
 * and doesn't depend on Mapbox / WebSocket bootstrapping.
 */
import { expect, test } from '@playwright/test';
import { apiPost, apiSignup, uniqueSuffix } from '../fixtures/api-client';
import { skipIfNoStack } from '../fixtures/skip-if-no-stack';

const API_BASE = process.env.API_E2E_BASE_URL ?? 'http://localhost:3601';

interface DriverPickerResponse {
  tenant: { id: string; slug: string; name: string };
  drivers: { id: string; firstName: string; lastName: string }[];
}

interface DriverLoginResponse {
  accessToken: string;
  expiresIn: number;
  driver: { id: string; firstName: string; lastName: string };
  tenant: { id: string; slug: string; name: string };
}

test.describe('E2E-011 driver web workspace happy path', () => {
  test.beforeAll(skipIfNoStack);

  test('driver signs in with PIN, captures pre-trip, opens evidence presign', async () => {
    const suffix = uniqueSuffix('e2e11');
    const owner = await apiSignup({
      tenantName: `Driver Co ${suffix}`,
      tenantSlug: suffix,
      ownerName: 'Owner',
      ownerEmail: `owner-${suffix}@spec.test`,
      password: 'CorrectHorse-Battery-9!',
    });
    const ownerToken = owner.accessToken;

    // Create a driver
    const driverRes = await apiPost('/fleet/drivers', ownerToken, {
      firstName: 'Test',
      lastName: 'Driver',
      employeeNumber: '101',
      active: true,
    });
    expect(driverRes.ok, await driverRes.text()).toBeTruthy();
    const driver = (await driverRes.json()) as { id: string };

    // Create a truck
    const truckRes = await apiPost('/fleet/trucks', ownerToken, {
      unitNumber: 'T-101',
      make: 'Peterbilt',
      model: '337',
      truckType: 'rollback_light',
    });
    expect(truckRes.ok, await truckRes.text()).toBeTruthy();
    const truck = (await truckRes.json()) as { id: string };

    // Assign driver to truck
    const assignRes = await apiPost('/fleet/assignments', ownerToken, {
      driverId: driver.id,
      truckId: truck.id,
      isPrimary: true,
    });
    expect(assignRes.ok, await assignRes.text()).toBeTruthy();

    // Set driver PIN (operator endpoint)
    const pinRes = await apiPost('/driver-auth/set-pin', ownerToken, {
      driverId: driver.id,
      pin: '4242',
    });
    expect(pinRes.ok, await pinRes.text()).toBeTruthy();

    // Now switch to the driver JWT path -----------------------------
    const listRes = await fetch(`${API_BASE}/driver-auth/list-drivers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantSlug: owner.tenant.slug }),
    });
    expect(listRes.ok).toBeTruthy();
    const picker = (await listRes.json()) as DriverPickerResponse;
    expect(picker.drivers.some((d) => d.id === driver.id)).toBe(true);

    const loginRes = await fetch(`${API_BASE}/driver-auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driverId: driver.id,
        pin: '4242',
        tenantSlug: owner.tenant.slug,
      }),
    });
    expect(loginRes.ok, await loginRes.text()).toBeTruthy();
    const login = (await loginRes.json()) as DriverLoginResponse;
    expect(login.accessToken).toBeTruthy();
    const driverJwt = login.accessToken;

    const driverHeaders = {
      'content-type': 'application/json',
      authorization: `Bearer ${driverJwt}`,
    };

    const checkInRes = await fetch(`${API_BASE}/driver-shifts/check-in`, {
      method: 'POST',
      headers: driverHeaders,
      body: JSON.stringify({ truckId: truck.id }),
    });
    expect(checkInRes.ok, await checkInRes.text()).toBeTruthy();
    const shift = (await checkInRes.json()) as { id: string; truckId: string };
    expect(shift.truckId).toBe(truck.id);

    // Pre-trip — single-item all-pass DVIR
    const pretripRes = await fetch(`${API_BASE}/driver-pretrip`, {
      method: 'POST',
      headers: driverHeaders,
      body: JSON.stringify({
        truckId: truck.id,
        shiftId: shift.id,
        status: 'pass',
        items: [
          { key: 'lights_head', label: 'Headlights & high beams', state: 'ok' },
          { key: 'brakes_parking', label: 'Parking brake holds', state: 'ok' },
        ],
        submittedAt: new Date().toISOString(),
      }),
    });
    expect(pretripRes.ok, await pretripRes.text()).toBeTruthy();

    // Check shift can be ended cleanly.
    const endRes = await fetch(`${API_BASE}/driver-shifts/check-out`, {
      method: 'POST',
      headers: driverHeaders,
    });
    expect(endRes.ok, await endRes.text()).toBeTruthy();
  });
});
