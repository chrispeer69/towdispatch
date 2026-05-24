/**
 * PRODUCTION SMOKE — one comprehensive flow against a LIVE deploy.
 *
 *   signup → first invoice → Towbook import → web tier reachable →
 *   deliberate 500 → Sentry event verification → idempotent cleanup
 *
 * This spec is DELIBERATELY excluded from the normal e2e run. It is gated by
 * SMOKE_RUN_AGAINST_PROD=1 (set only by `pnpm smoke:prod`), independent of
 * the docker-stack flag the rest of the suite uses (E2E_RUN_REQUIRES_STACK).
 * That separation means a future CI change that flips the stack flag can
 * never accidentally fire real signups / imports at production.
 *
 * It hits real services and creates real (synthetic) data. Read
 * apps/e2e/PRODUCTION_SMOKE.md before running. Required env lives in
 * apps/e2e/.env.smoke.example.
 *
 * Soft vs hard:
 *   - Core flow (signup, invoice, import, web reachability) is HARD-asserted.
 *   - The deliberate-500 + Sentry legs SOFT-SKIP (annotation, no failure)
 *     when the guarded /_debug/boom route isn't deployed/enabled or when
 *     Sentry query creds are absent — so the harness is still useful on a
 *     deploy that hasn't opted into the debug endpoint yet.
 *   - Cleanup is best-effort and never fails the test.
 */
import { expect, test } from '@playwright/test';

const RUN = process.env.SMOKE_RUN_AGAINST_PROD === '1';

const API = (process.env.PROD_API_URL ?? '').replace(/\/$/, '');
const WEB = (process.env.PROD_WEB_URL ?? '').replace(/\/$/, '');
const BASE_EMAIL = process.env.SMOKE_TEST_EMAIL ?? '';
const TENANT_NAME = process.env.SMOKE_TEST_TENANT_NAME ?? 'Smoke Test Towing';
const PASSWORD = process.env.SMOKE_TEST_PASSWORD ?? 'CorrectHorse-Battery-9!';

const SMOKE_DEBUG_TOKEN = process.env.SMOKE_DEBUG_TOKEN ?? '';

const SENTRY_API_URL = (process.env.SENTRY_API_URL ?? 'https://sentry.io').replace(/\/$/, '');
const SENTRY_API_TOKEN = process.env.SENTRY_API_TOKEN ?? '';
const SENTRY_ORG = process.env.SENTRY_ORG ?? '';
const SENTRY_PROJECT = process.env.SENTRY_PROJECT ?? '';

/** Random suffix so concurrent / repeated runs never collide. */
function uniqueSuffix(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Plus-address the base inbox so every run is unique but mail still routes. */
function plusAddress(base: string, tag: string): string {
  const at = base.indexOf('@');
  if (at < 0) return base;
  return `${base.slice(0, at)}+${tag}${base.slice(at)}`;
}

function csv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return '';
  const header = Object.keys(rows[0] ?? {});
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      header
        .map((h) => {
          const v = r[h] ?? '';
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Hand-rolled STORED-method ZIP — no deps. Mirrors e2e-006's composer. */
function buildZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) {
      c ^= byte;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(f.data.length, 18);
    localHeader.writeUInt32LE(f.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, f.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(f.data.length, 20);
    centralHeader.writeUInt32LE(f.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += 30 + name.length + f.data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const b of central) centralSize += b.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...local, ...central, eocd]);
}

function buildMiniBundle(): Buffer {
  const customers = csv([
    {
      towbook_id: 'C-SMOKE-1',
      name: 'Smoke Synthetic Customer',
      phone_primary: '+13105550100',
      email: 'smoke-c1@spec.test',
      street_address: '1 Main',
      city: 'Brooklyn',
      state: 'NY',
      zip: '11201',
      account_type: 'cash',
      created_date: '2024-01-01 09:00:00',
    },
  ]);
  return buildZip([{ name: 'customers.csv', data: Buffer.from(customers, 'utf8') }]);
}

function softSkip(reason: string): void {
  // Surface as a test annotation + log line; does NOT fail the run.
  test.info().annotations.push({ type: 'skipped-leg', description: reason });
  console.warn(`[production-smoke] SOFT-SKIP: ${reason}`);
}

test.describe('PRODUCTION SMOKE', () => {
  test.skip(
    !RUN,
    'Production smoke is opt-in. Run `pnpm smoke:prod` (sets SMOKE_RUN_AGAINST_PROD=1).',
  );

  test('signup → invoice → import → web → 500 → sentry → cleanup', async ({ page }) => {
    // The full flow legitimately takes longer than the suite default.
    test.setTimeout(180_000);

    expect(API, 'PROD_API_URL must be set').toBeTruthy();
    expect(WEB, 'PROD_WEB_URL must be set').toBeTruthy();
    expect(BASE_EMAIL, 'SMOKE_TEST_EMAIL must be set').toBeTruthy();

    const suffix = uniqueSuffix('smoke');
    const ownerEmail = plusAddress(BASE_EMAIL, suffix);
    let accessToken = '';
    let tenantId = '';

    await test.step('signup creates tenant + OWNER and returns tokens', async () => {
      // Email verification is intentionally NOT exercised: signup issues
      // tokens immediately and login is not gated on verification (see
      // SMOKE_SPRINT_DECISIONS.md). This mirrors e2e-005, which signs up
      // with plain addresses and proceeds without an inbox round-trip.
      const res = await fetch(`${API}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantName: `${TENANT_NAME} ${suffix}`,
          tenantSlug: suffix,
          ownerName: 'Smoke Owner',
          ownerEmail,
          password: PASSWORD,
        }),
      });
      const raw = await res.text();
      expect(res.ok, `signup failed: ${res.status} ${raw}`).toBe(true);
      const body = JSON.parse(raw) as {
        status: string;
        accessToken: string;
        tenant: { id: string; slug: string };
      };
      expect(body.status).toBe('authenticated');
      expect(body.accessToken).toBeTruthy();
      expect(body.tenant.id).toBeTruthy();
      accessToken = body.accessToken;
      tenantId = body.tenant.id;
    });

    await test.step('create first invoice', async () => {
      const res = await fetch(`${API}/billing/invoices`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          invoiceType: 'manual',
          terms: 'net_30',
          notes: `production smoke ${suffix}`,
          lineItems: [
            {
              description: 'Smoke test tow service',
              quantity: 1,
              unit: 'each',
              unitPriceCents: 12_500,
              taxable: false,
            },
          ],
        }),
      });
      const raw = await res.text();
      expect(res.ok, `invoice create failed: ${res.status} ${raw}`).toBe(true);
      const body = JSON.parse(raw) as {
        id: string;
        invoiceNumber: string;
        status: string;
        lineItems: unknown[];
      };
      expect(body.id).toBeTruthy();
      expect(body.invoiceNumber).toBeTruthy();
      expect(Array.isArray(body.lineItems)).toBe(true);
      expect(body.lineItems.length).toBe(1);
    });

    await test.step('Towbook import (live) succeeds and persists', async () => {
      const bundle = buildMiniBundle();
      const res = await fetch(`${API}/import/runs?mode=live&tenantId=${tenantId}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/zip',
        },
        body: bundle,
      });
      const raw = await res.text();
      expect(res.ok, `import failed: ${res.status} ${raw}`).toBe(true);
      const body = JSON.parse(raw) as {
        runId: string;
        status: string;
        totals: Record<string, { created?: number } | undefined>;
      };
      expect(body.status).toBe('completed');
      expect(body.totals.customers?.created ?? 0).toBeGreaterThanOrEqual(1);

      // Confirm the run is persisted and readable back.
      const getRes = await fetch(`${API}/import/runs/${body.runId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(getRes.ok, `import run read-back failed: ${getRes.status}`).toBe(true);
      const getBody = (await getRes.json()) as { run: { status: string } | null };
      expect(getBody.run?.status).toBe('completed');
    });

    await test.step('web tier is reachable', async () => {
      const resp = await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
      expect(resp, 'no response from web /login').not.toBeNull();
      expect(resp?.status() ?? 599, `web /login returned ${resp?.status()}`).toBeLessThan(400);
      // A non-empty document is enough of a liveness signal for the web tier;
      // deeper UI assertions belong in the in-tree apps/web e2e suite.
      await expect(page.locator('body')).not.toBeEmpty();
    });

    const marker = `${suffix}-boom`;
    let triggered500 = false;

    await test.step('trigger a deliberate 500', async () => {
      if (!SMOKE_DEBUG_TOKEN) {
        softSkip('SMOKE_DEBUG_TOKEN not set — cannot invoke /_debug/boom.');
        return;
      }
      const res = await fetch(`${API}/_debug/boom?marker=${encodeURIComponent(marker)}`, {
        headers: { authorization: `Bearer ${SMOKE_DEBUG_TOKEN}` },
      });
      if (res.status === 500) {
        triggered500 = true;
        return;
      }
      // Optional leg — surface the unexpected status rather than failing the
      // whole run: 404 = route not deployed / SMOKE_DEBUG_ERROR_ENABLED false;
      // 401 = token mismatch; 403/502 = a gateway/WAF fronting the API.
      softSkip(`/_debug/boom returned ${res.status} (expected 500) — 500 + Sentry legs skipped.`);
    });

    await test.step('verify Sentry captured the event', async () => {
      if (!triggered500) {
        softSkip('Skipping Sentry verification — no 500 was triggered.');
        return;
      }
      if (!SENTRY_API_TOKEN || !SENTRY_ORG || !SENTRY_PROJECT) {
        softSkip(
          'Sentry query creds absent (SENTRY_API_TOKEN/ORG/PROJECT) — 500 fired but not verified in Sentry.',
        );
        return;
      }
      const url = `${SENTRY_API_URL}/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=${encodeURIComponent(
        `smoke_marker:${marker}`,
      )}&statsPeriod=1h`;

      // Events take a few seconds to index. Poll up to ~90s.
      const deadline = Date.now() + 90_000;
      let found = false;
      while (Date.now() < deadline) {
        const res = await fetch(url, {
          headers: { authorization: `Bearer ${SENTRY_API_TOKEN}` },
        });
        if (res.ok) {
          const issues = (await res.json()) as unknown[];
          if (Array.isArray(issues) && issues.length > 0) {
            found = true;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 5_000));
      }
      expect(found, `no Sentry issue found for smoke_marker:${marker} within 90s`).toBe(true);
    });

    await test.step('best-effort cleanup (mark synthetic tenant)', async () => {
      // No tenant soft-delete endpoint exists yet (see SMOKE_SPRINT_DECISIONS
      // .md 🟡). Rename the tenant with a stable `[SMOKE-CLEANUP]` prefix so a
      // future platform-admin purge job has a selector. (The settings object
      // can't carry a custom flag — its partial schema strips unknown keys
      // and then rejects the empty result — so the name prefix is the marker.)
      // Never fails the test.
      try {
        const res = await fetch(`${API}/tenants/current`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            name: `[SMOKE-CLEANUP] ${TENANT_NAME} ${suffix}`.slice(0, 120),
          }),
        });
        if (!res.ok) {
          softSkip(
            `cleanup rename returned ${res.status} — synthetic tenant left for manual purge.`,
          );
        }
      } catch (err) {
        softSkip(`cleanup threw (${String(err)}) — synthetic tenant left for manual purge.`);
      }
    });
  });
});
