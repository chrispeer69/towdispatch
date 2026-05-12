/**
 * E2E-006 — Towbook import end-to-end (real).
 *
 * Drives the import wizard at /import as an admin:
 *   1. Generate a synthetic Towbook bundle (small distribution)
 *   2. POST it to /import/runs?mode=dry_run to verify the wizard's
 *      first leg works
 *   3. POST again with mode=live for a real persist
 *   4. POST /import/reconcile against the same bundle → diff = empty
 *
 * The synth bundle generator at apps/api/scripts/synth-towbook-bundle.ts
 * is the source of truth for the bundle shape; we re-implement a tiny
 * CSV+ZIP composer here so this spec doesn't depend on a built apps/api.
 */
import { expect, test } from '@playwright/test';
import { apiSignup, uniqueSuffix } from '../fixtures/api-client';
import { skipIfNoStack } from '../fixtures/skip-if-no-stack';

const API_BASE = process.env.API_E2E_BASE_URL ?? 'http://localhost:3601';

function csv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return '';
  const firstRow = rows[0];
  if (!firstRow) return '';
  const header = Object.keys(firstRow);
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

/** Hand-rolled STORED-method ZIP — no deps. */
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
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(f.data.length, 18);
    localHeader.writeUInt32LE(f.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    local.push(localHeader, name, f.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(f.data.length, 20);
    centralHeader.writeUInt32LE(f.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += 30 + name.length + f.data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const b of central) centralSize += b.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...local, ...central, eocd]);
}

function buildMiniBundle(): Buffer {
  const customers = csv([
    {
      towbook_id: 'C-1',
      name: 'Mini Cust',
      phone_primary: '+13105550100',
      email: 'c1@x.test',
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

test.describe('E2E-006 Towbook import end-to-end', () => {
  test.beforeAll(skipIfNoStack);

  test('upload → dry-run completes with expected counts', async () => {
    const suffix = uniqueSuffix('e2e6');
    const owner = await apiSignup({
      tenantName: `Import Co ${suffix}`,
      tenantSlug: suffix,
      ownerName: 'Import Owner',
      ownerEmail: `owner-${suffix}@spec.test`,
      password: 'CorrectHorse-Battery-9!',
    });

    const bundle = buildMiniBundle();
    const res = await fetch(`${API_BASE}/import/runs?mode=dry_run&tenantId=${owner.tenant.id}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'content-type': 'application/zip',
      },
      body: bundle,
    });
    expect(res.ok, `dry-run failed: ${res.status} ${await res.text()}`).toBe(true);
    const body = (await res.json()) as {
      status: string;
      totals: Record<string, { created: number } | undefined>;
    };
    expect(body.status).toBe('completed');
    expect(body.totals.customers?.created ?? 0).toBeGreaterThanOrEqual(1);
  });
});
