/**
 * Call-intake end-to-end smoke test.
 *
 * Steps:
 *   1. Log in as the seeded acme owner (default rate sheet already seeded
 *      for that tenant).
 *   2. Navigate to /intake.
 *   3. Type a phone, name, plate, state, year/make/model, pickup, and dropoff
 *      with coords.
 *   4. Click DISPATCH and capture the API response so we know the new job's id.
 *   5. Land on /dispatch?created=YYYYMMDD-NNNN with a success banner.
 *   6. Confirm via the API that GET /jobs/:id returns a row with the
 *      caller's tenant_id, status='new', and a positive rate.
 */
import { expect, test } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

test.describe('Call intake', () => {
  test('phone + plate + tow → DISPATCH creates a job, lands on /dispatch with toast', async ({
    page,
  }) => {
    // 1. login
    await page.goto('/login');
    await page.fill('input[autocomplete="email"]', 'owner@acme.test');
    await page.fill('input[autocomplete="current-password"]', 'ChangeMe123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(app|dashboard)/);

    // Plate that's unique per run so we don't trip the existing-vehicle
    // re-use path on repeat test runs against the dev DB.
    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3).toString(36)}`.toUpperCase();
    const plate = `E2E${stamp}`.slice(0, 8);
    const phoneTail = String(Date.now() % 1_000_000).padStart(6, '0');
    const phone = `555-555-${phoneTail.slice(0, 4)}`;

    // 2. open /intake
    await page.goto('/intake');
    await expect(page.getByRole('heading', { name: 'Call Intake' })).toBeVisible();

    // 3. fill the form
    await page.getByTestId('intake-phone').fill(phone);
    await page.getByTestId('intake-customer-name').fill('E2E Caller');
    await page.getByTestId('intake-plate').fill(plate);
    await page.getByPlaceholder('OH').fill('OH');
    await page.getByPlaceholder('2018').fill('2018');
    await page.getByPlaceholder('Honda').fill('Honda');
    await page.getByPlaceholder('Civic').fill('Civic');

    // Service type (tow is the default; click for explicitness).
    await page.getByTestId('intake-service-tow').click();

    // Pickup
    await page.getByTestId('intake-pickup-address').fill('100 E2E Main St, Columbus OH');
    const latInputs = page.getByPlaceholder('Lat');
    const lngInputs = page.getByPlaceholder('Lng');
    await latInputs.first().fill('39.9612');
    await lngInputs.first().fill('-82.9988');

    // Dropoff
    await page.getByTestId('intake-dropoff-address').fill('500 E2E Broad St, Columbus OH');
    await latInputs.nth(1).fill('39.9655');
    await lngInputs.nth(1).fill('-82.9852');

    // Live quote settles.
    await expect(page.getByTestId('intake-rate-total')).not.toHaveText('$0.00', {
      timeout: 5_000,
    });

    // 4. click DISPATCH and capture the API response so we have the job id.
    const intakeRespPromise = page.waitForResponse(
      (r) => r.url().endsWith('/api/jobs/intake') && r.request().method() === 'POST',
    );
    await page.getByTestId('intake-dispatch').click();
    const intakeResp = await intakeRespPromise;
    expect(intakeResp.status()).toBe(201);
    const intakeData = (await intakeResp.json()) as {
      job: { id: string; jobNumber: string; tenantId: string; status: string; rateQuotedCents: number };
    };

    // 5. landed on /dispatch with toast and ?created=YYYYMMDD-NNNN.
    await expect(page).toHaveURL(/\/dispatch\?created=\d{8}-\d{4}/);
    const toast = page.getByTestId('intake-success-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(intakeData.job.jobNumber);

    // 6. API confirmation: GET /jobs/:id (still authenticated). Read access
    // is gated by RLS so a successful 200 here proves the row is owned by
    // this caller's tenant.
    const apiLogin = await page.request.post(`${API_URL}/auth/login`, {
      data: { email: 'owner@acme.test', password: 'ChangeMe123!' },
    });
    expect(apiLogin.ok()).toBe(true);
    const apiLoginData = (await apiLogin.json()) as { accessToken: string; tenant: { id: string } };

    const jobResp = await page.request.get(`${API_URL}/jobs/${intakeData.job.id}`, {
      headers: { authorization: `Bearer ${apiLoginData.accessToken}` },
    });
    expect(jobResp.status()).toBe(200);
    const job = (await jobResp.json()) as {
      tenantId: string;
      status: string;
      rateQuotedCents: number;
      jobNumber: string;
    };
    expect(job.tenantId).toBe(apiLoginData.tenant.id);
    expect(job.status).toBe('new');
    expect(job.rateQuotedCents).toBeGreaterThan(0);
    expect(job.jobNumber).toBe(intakeData.job.jobNumber);

    // Cancel the test job so reruns against the dev DB don't pile up.
    await page.request.post(`${API_URL}/jobs/${intakeData.job.id}/cancel`, {
      data: { reason: 'e2e cleanup' },
      headers: { authorization: `Bearer ${apiLoginData.accessToken}` },
    });
  });
});
