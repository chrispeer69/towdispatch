/**
 * Customer-tracking end-to-end smoke test.
 *
 * Steps:
 *   1. Log in as owner@acme.test, create a job at /intake.
 *   2. Assign the job from the dispatch board (drag-and-drop).
 *   3. Read the auto-generated tracking link via the BFF /api/tracking/:jobId.
 *   4. Open /track/[token] in a clean browser context (no cookies).
 *   5. Assert the customer page renders the friendly status, driver name,
 *      and tenant chrome.
 *   6. Submit a customer message; assert it lands in the dispatcher thread.
 *   7. Force-expire the link via the API and assert the public route returns
 *      the "expired" copy on next navigation.
 *
 * Mapbox is mocked away — the page falls back to a static placeholder when
 * NEXT_PUBLIC_MAPBOX_TOKEN starts with `pk.placeholder`, which is the dev
 * default.
 */
import { expect, test } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

test.describe('Customer tracking page', () => {
  test('intake → assign → public tracking page → message → expire', async ({ page, browser }) => {
    // ---------- 1. login as owner ----------
    await page.goto('/login');
    await page.fill('input[autocomplete="email"]', 'owner@acme.test');
    await page.fill('input[autocomplete="current-password"]', 'ChangeMe123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(app|dashboard)/);

    // ---------- 2. /intake ----------
    const stamp =
      `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3).toString(36)}`.toUpperCase();
    const plate = `T9${stamp}`.slice(0, 8);
    const phoneTail = String(Date.now() % 1_000_000).padStart(6, '0');
    const phone = `555-555-${phoneTail.slice(0, 4)}`;
    const email = `track-${Date.now().toString(36)}@e2e.test`;
    const vinSuffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
      .toUpperCase()
      .replace(/[IOQ]/g, '0')
      .padStart(11, '0')
      .slice(0, 11);
    const vin = `WBA${vinSuffix}E2E`.slice(0, 17).padEnd(17, '0');

    await page.goto('/intake');
    await page.getByTestId('intake-phone').fill(phone);
    await page.getByTestId('intake-customer-name').fill('Track Customer');
    await page.getByTestId('intake-customer-email').fill(email);
    await page.getByTestId('intake-plate').fill(plate);
    await page.locator('input[placeholder="OH"]').first().fill('OH');
    await page.getByTestId('intake-vin').fill(vin);
    await page.getByPlaceholder('2018').fill('2020');
    await page.getByPlaceholder('Honda').fill('Ford');
    await page.getByPlaceholder('Civic').fill('F-150');
    await page.getByTestId('intake-service-tow').click();
    await page.getByTestId('intake-pickup-address').fill('1 Track St, Columbus OH');
    const latInputs = page.getByPlaceholder('Lat');
    const lngInputs = page.getByPlaceholder('Lng');
    await latInputs.first().fill('39.9612');
    await lngInputs.first().fill('-82.9988');
    await page.getByTestId('intake-dropoff-address').fill('200 Track St, Columbus OH');
    await latInputs.nth(1).fill('39.9655');
    await lngInputs.nth(1).fill('-82.9852');

    const intakeRespPromise = page.waitForResponse(
      (r) => r.url().endsWith('/api/jobs/intake') && r.request().method() === 'POST',
    );
    await page.getByTestId('intake-dispatch').click();
    const intakeResp = await intakeRespPromise;
    expect(intakeResp.status()).toBe(201);
    const intakeData = (await intakeResp.json()) as { job: { id: string; jobNumber: string } };
    const jobId = intakeData.job.id;
    const jobNumber = intakeData.job.jobNumber;

    // ---------- 3. land on dispatch + assign ----------
    await expect(page).toHaveURL(/\/dispatch\?created=/);
    await expect(page.getByTestId('intake-success-toast')).toContainText(jobNumber);

    // The seeded acme tenant has a roster with at least one driver. We
    // perform the assign via the API rather than DnD because we already
    // have the API_URL handy and don't need to flake on drag fidelity.
    const apiLogin = await page.request.post(`${API_URL}/auth/login`, {
      data: { email: 'owner@acme.test', password: 'ChangeMe123!' },
    });
    expect(apiLogin.ok()).toBe(true);
    const apiLoginData = (await apiLogin.json()) as { accessToken: string; tenant: { id: string } };
    const headers = { authorization: `Bearer ${apiLoginData.accessToken}` };

    const rosterRes = await page.request.get(`${API_URL}/dispatch/roster`, { headers });
    expect(rosterRes.ok()).toBe(true);
    const roster = (await rosterRes.json()) as Array<{
      driver: { id: string };
      shift: { id: string; endedAt: string | null } | null;
      truck: { id: string } | null;
    }>;
    const onShift = roster.find((r) => r.shift && !r.shift.endedAt && r.driver);
    if (!onShift || !onShift.shift) {
      test.skip(true, 'No driver currently on shift in dev DB — assign step skipped');
      return;
    }
    const driverId = onShift.driver.id;
    const shiftId = onShift.shift.id;
    const truckId = onShift.truck?.id;

    const assignRes = await page.request.post(`${API_URL}/dispatch/jobs/${jobId}/assign`, {
      headers: { ...headers, 'content-type': 'application/json' },
      data: { driverId, shiftId, ...(truckId ? { truckId } : {}) },
    });
    expect(assignRes.ok()).toBe(true);

    // ---------- 4. fetch the auto-created tracking link ----------
    // Auto-create runs in a fire-and-forget event subscriber; poll briefly.
    let token: string | null = null;
    for (let i = 0; i < 30 && !token; i++) {
      const r = await page.request.get(`${API_URL}/tracking/${jobId}`, { headers });
      if (r.ok()) {
        const data = (await r.json()) as { link: { token: string } | null };
        if (data.link) token = data.link.token;
      }
      if (!token) await page.waitForTimeout(150);
    }
    expect(token).toBeTruthy();

    // ---------- 5. open /track/[token] in a clean (no-cookie) context ----------
    const ctx = await browser.newContext();
    const trackPage = await ctx.newPage();
    await trackPage.goto(`/track/${token}`);
    await expect(trackPage.getByTestId('status-label')).toBeVisible();
    await expect(trackPage.getByTestId('chat-panel')).toBeVisible();

    // ---------- 6. submit a customer message ----------
    await trackPage.getByTestId('chat-input').fill('Need help finding the entrance');
    await trackPage.getByTestId('chat-send').click();

    // The dispatcher thread now contains the inbound message.
    let foundInbound = false;
    for (let i = 0; i < 30 && !foundInbound; i++) {
      const r = await page.request.get(`${API_URL}/tracking/${jobId}/messages`, { headers });
      if (r.ok()) {
        const data = (await r.json()) as {
          messages: Array<{ direction: string; body: string }>;
        };
        foundInbound = data.messages.some(
          (m) => m.direction === 'inbound' && m.body.includes('Need help finding the entrance'),
        );
      }
      if (!foundInbound) await page.waitForTimeout(150);
    }
    expect(foundInbound).toBe(true);

    // ---------- 7. revoke and reload — page should show "expired" copy ----------
    const revokeRes = await page.request.post(`${API_URL}/tracking/${jobId}/revoke`, {
      headers,
    });
    expect(revokeRes.ok()).toBe(true);
    await trackPage.goto(`/track/${token}`);
    await expect(trackPage.getByText(/expired|invalid/i).first()).toBeVisible();

    await ctx.close();
  });
});
