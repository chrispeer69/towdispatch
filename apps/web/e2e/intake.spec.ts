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
    const email = `e2e-${Date.now().toString(36)}@intake.test`;
    // Stable, valid 17-char VIN (A-Z minus I/O/Q + digits) varied per run by
    // the suffix so back-to-back runs against the dev DB don't collide.
    const vinSuffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
      .toUpperCase()
      .replace(/[IOQ]/g, '0')
      .padStart(11, '0')
      .slice(0, 11);
    const vin = `WBA${vinSuffix}E2E`.slice(0, 17).padEnd(17, '0');

    // 2. open /intake
    await page.goto('/intake');
    await expect(page.getByRole('heading', { name: 'Call Intake' })).toBeVisible();

    // 3. fill the form — VIN + email are required as of Session 4 cleanup.
    await page.getByTestId('intake-phone').fill(phone);
    await page.getByTestId('intake-customer-name').fill('E2E Caller');
    await page.getByTestId('intake-customer-email').fill(email);

    // Open the additional contact info panel and fill the new fields.
    await page.getByTestId('intake-additional-contact').click();
    await page.getByTestId('intake-home-street').fill('123 E2E St');
    await page.getByTestId('intake-home-city').fill('Columbus');
    await page.getByTestId('intake-home-state').fill('OH');
    await page.getByTestId('intake-home-zip').fill('43215');
    await page.getByTestId('intake-secondary-name').fill('Spouse Caller');
    await page.getByTestId('intake-secondary-phone').fill('555-555-9999');
    await page.getByTestId('intake-convini-app').check();

    await page.getByTestId('intake-plate').fill(plate);
    await page.locator('input[placeholder="OH"]').first().fill('OH');
    await page.getByTestId('intake-vin').fill(vin);
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
      customer: { id: string };
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

    // Confirm the new customer expansion fields persisted (Session 4 cleanup).
    const customerResp = await page.request.get(
      `${API_URL}/customers/${intakeData.customer.id}`,
      { headers: { authorization: `Bearer ${apiLoginData.accessToken}` } },
    );
    expect(customerResp.status()).toBe(200);
    const cust = (await customerResp.json()) as {
      homeAddressStreet: string | null;
      homeAddressCity: string | null;
      homeAddressState: string | null;
      homeAddressZip: string | null;
      secondaryContactName: string | null;
      secondaryContactPhone: string | null;
      conviniAppDownloaded: boolean;
      email: string | null;
    };
    expect(cust.homeAddressStreet).toBe('123 E2E St');
    expect(cust.homeAddressCity).toBe('Columbus');
    expect(cust.homeAddressState).toBe('OH');
    expect(cust.homeAddressZip).toBe('43215');
    expect(cust.secondaryContactName).toBe('Spouse Caller');
    expect(cust.conviniAppDownloaded).toBe(true);
    expect(cust.email).toBe(email);

    // Cancel the test job so reruns against the dev DB don't pile up.
    await page.request.post(`${API_URL}/jobs/${intakeData.job.id}/cancel`, {
      data: { reason: 'e2e cleanup' },
      headers: { authorization: `Bearer ${apiLoginData.accessToken}` },
    });
  });

  // -------------------------------------------------------------------- //
  // Session 4 cleanup — VIN + email gate the DISPATCH button.
  // -------------------------------------------------------------------- //
  test('DISPATCH is blocked while VIN or email is missing/invalid', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[autocomplete="email"]', 'owner@acme.test');
    await page.fill('input[autocomplete="current-password"]', 'ChangeMe123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(app|dashboard)/);

    await page.goto('/intake');
    await expect(page.getByRole('heading', { name: 'Call Intake' })).toBeVisible();

    const dispatch = page.getByTestId('intake-dispatch');

    // Fresh form: VIN empty + email empty → DISPATCH disabled.
    await expect(dispatch).toBeDisabled();

    // Fill email but leave VIN empty.
    await page.getByTestId('intake-customer-email').fill('valid@example.com');
    await expect(dispatch).toBeDisabled();

    // Type a malformed VIN (contains I/O/Q) — DISPATCH still disabled and
    // the inline error surfaces once the field has been touched.
    const vinField = page.getByTestId('intake-vin');
    await vinField.fill('IOQ45678901234567');
    await vinField.blur();
    await expect(page.getByTestId('intake-vin-error')).toBeVisible();
    await expect(dispatch).toBeDisabled();

    // Fix VIN — DISPATCH becomes enabled (other fields are also required for
    // the actual submit, but the gate only watches VIN + email validity).
    await vinField.fill('WBA12345678901234');
    await vinField.blur();
    await expect(page.getByTestId('intake-vin-error')).toBeHidden();
    await expect(dispatch).toBeEnabled();

    // Clear email → DISPATCH disabled again, email error surfaces.
    const emailField = page.getByTestId('intake-customer-email');
    await emailField.fill('');
    await emailField.blur();
    await expect(page.getByTestId('intake-email-error')).toBeVisible();
    await expect(dispatch).toBeDisabled();
  });
});
