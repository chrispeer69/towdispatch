/**
 * End-to-end authentication smoke test. Uses the running API + Mailhog stack.
 *
 *   1. Sign up a new tenant via /signup
 *   2. Pull the verification link out of Mailhog and visit it
 *   3. Sign out
 *   4. Sign back in
 *   5. Land on /app
 */
import { expect, test } from '@playwright/test';

const MAILHOG_API = process.env.MAILHOG_API ?? 'http://localhost:8025';

interface MailhogMessage {
  ID: string;
  Content: { Body: string; Headers: Record<string, string[]> };
  To: Array<{ Mailbox: string; Domain: string }>;
}

interface MailhogResponse {
  total: number;
  count: number;
  start: number;
  items: MailhogMessage[];
}

async function waitForMailTo(email: string, timeoutMs = 30_000): Promise<MailhogMessage> {
  const deadline = Date.now() + timeoutMs;
  let last: MailhogMessage | null = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILHOG_API}/api/v2/messages`);
    if (res.ok) {
      const data = (await res.json()) as MailhogResponse;
      const match = data.items.find((m) =>
        m.To.some((t) => `${t.Mailbox}@${t.Domain}`.toLowerCase() === email.toLowerCase()),
      );
      if (match) {
        last = match;
        return match;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `No mail to ${email} arrived within ${timeoutMs}ms (last seen: ${last ? 'partial' : 'none'})`,
  );
}

function extractVerifyUrl(body: string): string {
  // Mailhog content keeps quoted-printable line wraps; collapse them so the
  // URL re-assembles intact before we regex.
  const cleaned = body
    .replace(/=\r?\n/g, '')
    .replace(/=3D/g, '=')
    .replace(/&amp;/g, '&');
  const m = cleaned.match(/https?:\/\/[^\s"<>)]+\/verify-email\?token=[A-Za-z0-9_\-]+/);
  if (!m) throw new Error('Could not find /verify-email link in body');
  return m[0];
}

test.describe('Auth', () => {
  test('signup → verify email via mailhog → logout → login → dashboard', async ({ page }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-${stamp}`;
    const email = `e2e-${stamp}@auth.test`;
    const password = 'E2E-Strong-Password-9!';

    // Signup
    await page.goto('/signup');
    await page.fill('input[autocomplete="organization"]', `E2E ${slug}`);
    // Auto-slug should populate; clear it so we plant a known slug:
    const slugInput = page.locator('input[placeholder="acme-towing"]');
    await slugInput.click();
    await slugInput.press('ControlOrMeta+a');
    await slugInput.type(slug);
    await page.fill('input[autocomplete="name"]', 'E2E Tester');
    await page.fill('input[autocomplete="email"]', email);
    await page
      .locator('input[type="password"][autocomplete="new-password"]')
      .first()
      .fill(password);
    await page.locator('input[type="password"][autocomplete="new-password"]').nth(1).fill(password);
    await page.locator('input[type="checkbox"]').check();
    await page.click('button[type="submit"]');

    // Lands on the verify-pending page
    await expect(page).toHaveURL(/\/verify-email-pending/);

    // Pull verification link from Mailhog
    const message = await waitForMailTo(email);
    const verifyUrl = extractVerifyUrl(message.Content.Body);
    const verifyPath = new URL(verifyUrl).pathname + new URL(verifyUrl).search;

    await page.goto(verifyPath);
    await expect(page.getByText('Your email is confirmed')).toBeVisible({ timeout: 10_000 });

    // Continue to dashboard via the success button
    await page.click('a:has-text("Continue to dashboard")');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Operations Overview/i }).first()).toBeVisible();

    // Sign out
    await page.goto('/logout');
    await expect(page).toHaveURL(/\/$/);

    // Log back in
    await page.goto('/login');
    await page.fill('input[autocomplete="email"]', email);
    await page.fill('input[autocomplete="current-password"]', password);
    await page.click('button[type="submit"]');

    // Lands on /app
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Operations Overview/i }).first()).toBeVisible();
  });
});
