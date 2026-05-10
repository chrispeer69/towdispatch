/**
 * Fleet management end-to-end smoke test.
 *
 * Steps:
 *   1. Log in as owner@acme.test.
 *   2. Visit /fleet/trucks, create a new truck (unique unit number per run).
 *   3. On the truck detail page, upload a registration document with a
 *      future expiry inside the 30-day window.
 *   4. Visit /fleet/drivers, create a driver.
 *   5. On the driver detail page, assign the just-created truck.
 *   6. Visit /fleet/dvirs, submit a DVIR with an out_of_service defect for
 *      that truck.
 *   7. Open the truck detail page again — the status badge should show
 *      "in maintenance".
 *   8. Visit /fleet/expirations — the uploaded registration should appear
 *      in the warning bucket.
 */
import { expect, test } from '@playwright/test';

test.describe('Fleet management', () => {
  test('truck create → document upload → driver create → assign → DVIR out-of-service → expirations row', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.fill('input[autocomplete="email"]', 'owner@acme.test');
    await page.fill('input[autocomplete="current-password"]', 'ChangeMe123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(app|dashboard)/);

    const stamp =
      `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3).toString(36)}`.toUpperCase();
    const unitNumber = `E2E-${stamp}`.slice(0, 18);
    const driverLast = `Smith${stamp}`.slice(0, 24);

    // 2. New truck
    await page.goto('/fleet/trucks');
    await expect(page.getByTestId('trucks-table')).toBeVisible();
    await page.getByRole('link', { name: '+ New truck' }).click();
    await page.getByTestId('truck-unit').fill(unitNumber);
    await page.getByTestId('truck-submit').click();
    await page.waitForURL(/\/fleet\/trucks\/[0-9a-f-]{36}/);

    const truckUrl = page.url();
    const truckId = truckUrl.split('/').pop() as string;

    // 3. Upload a registration document via the truck profile section
    await expect(page.getByTestId('truck-documents-section')).toBeVisible();
    const expiryDate = new Date();
    expiryDate.setUTCDate(expiryDate.getUTCDate() + 20);
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    await page
      .locator('[data-testid="truck-documents-section"] select')
      .first()
      .selectOption('registration');
    await page
      .locator('[data-testid="truck-documents-section"] input[type="date"]')
      .fill(expiryStr);
    await page.setInputFiles('[data-testid="document-file-input"]', {
      name: `registration-${stamp}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-test\n'),
    });
    await page.getByTestId('document-upload-button').click();
    await expect(page.getByTestId('truck-documents-list')).toContainText(`registration-${stamp}`);

    // 4. New driver
    await page.goto('/fleet/drivers');
    await expect(page.getByTestId('drivers-table')).toBeVisible();
    await page.getByRole('link', { name: '+ New driver' }).click();
    await page.getByTestId('driver-first-name').fill('Mike');
    await page.getByTestId('driver-last-name').fill(driverLast);
    await page.getByTestId('driver-submit').click();
    await page.waitForURL(/\/fleet\/drivers\/[0-9a-f-]{36}/);
    const driverId = page.url().split('/').pop() as string;

    // 5. Assign the truck
    await expect(page.getByTestId('driver-assignments-section')).toBeVisible();
    await page.getByTestId('driver-assign-truck-select').selectOption(truckId);
    await page.getByTestId('driver-assign-truck-button').click();
    await expect(page.getByTestId('driver-assignments-list')).toContainText(unitNumber);

    // 6. DVIR with out_of_service defect
    await page.goto('/fleet/dvirs');
    await expect(page.getByTestId('dvir-submit-section')).toBeVisible();
    await page.getByTestId('dvir-driver-select').selectOption(driverId);
    await page.getByTestId('dvir-truck-select').selectOption(truckId);
    await page.getByTestId('dvir-add-defect').click();
    await page.getByTestId('dvir-defect-component-0').fill('Brakes');
    await page.getByTestId('dvir-defect-severity-0').selectOption('out_of_service');
    await page.getByTestId('dvir-submit-button').click();
    await expect(page.getByTestId('dvir-success')).toBeVisible({ timeout: 10000 });

    // 7. Truck profile shows in_maintenance now
    await page.goto(truckUrl);
    await expect(page.getByText(/in maintenance/i).first()).toBeVisible();

    // 8. Expirations dashboard contains the registration in warning bucket
    await page.goto('/fleet/expirations');
    await expect(page.getByTestId('expirations-warning')).toContainText('registration');
  });
});
