import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CollectorResult } from './_util';
import {
  RETENTION_MONTHS,
  buildManifest,
  evidenceDir,
  summarize,
  toEvidence,
  writeEvidenceItem,
  writeManifest,
} from './evidence';

const root = join(tmpdir(), `evidence-spec-${Date.now()}`);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('toEvidence', () => {
  it('omits optional fields when absent (exactOptionalPropertyTypes-safe)', () => {
    const r: CollectorResult = { status: 'ok', message: 'fine' };
    const item = toEvidence('c1', 'CC6.1', r, undefined, '2026-05-24T00:00:00.000Z');
    expect(item).toEqual({
      id: 'c1',
      control: 'CC6.1',
      status: 'ok',
      message: 'fine',
      collectedAt: '2026-05-24T00:00:00.000Z',
    });
    expect('details' in item).toBe(false);
    expect('data' in item).toBe(false);
  });

  it('carries details + structured data when present', () => {
    const r: CollectorResult = { status: 'warn', message: 'm', details: ['d1'] };
    const item = toEvidence('c2', 'CC7.1', r, { critical: 2 });
    expect(item.details).toEqual(['d1']);
    expect(item.data).toEqual({ critical: 2 });
  });
});

describe('summarize + buildManifest', () => {
  it('tallies statuses and builds a complete manifest', () => {
    const items = [
      toEvidence('a', 'CC1', { status: 'ok', message: 'x' }),
      toEvidence('b', 'CC2', { status: 'skip', message: 'y' }),
      toEvidence('c', 'CC3', { status: 'fail', message: 'z' }),
    ];
    expect(summarize(items)).toEqual({ ok: 1, warn: 0, skip: 1, fail: 1 });

    const m = buildManifest(items, 'type-ii-12mo', '2026-05-24T00:00:00.000Z');
    expect(m.window).toBe('type-ii-12mo');
    expect(m.retentionMonths).toBe(RETENTION_MONTHS);
    expect(m.items).toHaveLength(3);
    expect(m.items[0]).toEqual({
      id: 'a',
      control: 'CC1',
      status: 'ok',
      message: 'x',
      file: 'a.json',
    });
  });
});

describe('write helpers', () => {
  it('writes items + manifest to a dated dir that round-trips as JSON', () => {
    const dir = evidenceDir(root, '2026-05-24');
    expect(existsSync(dir)).toBe(true);

    const item = toEvidence('verify-backup', 'A1.2', { status: 'ok', message: 'fresh' });
    const itemPath = writeEvidenceItem(dir, item);
    expect(JSON.parse(readFileSync(itemPath, 'utf8'))).toMatchObject({
      id: 'verify-backup',
      status: 'ok',
    });

    const manifestPath = writeManifest(dir, buildManifest([item], 'type-ii-12mo'));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.summary.ok).toBe(1);
    expect(manifest.items[0].file).toBe('verify-backup.json');
  });
});
