import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CollectorResult } from './_util';
import { type CollectorSpec, collectFrom } from './collect-evidence';
import { evidenceDir } from './evidence';

const root = join(tmpdir(), `collect-spec-${Date.now()}`);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const fixed = (id: string, control: string, status: CollectorResult['status']): CollectorSpec => ({
  id,
  control,
  run: async () => ({ status, message: `${id} ran`, details: [`${control} detail`] }),
});

describe('collectFrom (full evidence run)', () => {
  it('writes one JSON per collector + a valid manifest', async () => {
    const dir = evidenceDir(root, '2026-05-24');
    const specs = [
      fixed('list-users-roles', 'CC6.1', 'skip'),
      fixed('verify-backup', 'A1.2', 'ok'),
      fixed('dependency-scan', 'CC7.1', 'warn'),
    ];
    const items = await collectFrom(dir, specs, []);

    expect(items).toHaveLength(3);
    for (const s of specs) expect(existsSync(join(dir, `${s.id}.json`))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.window).toBe('type-ii-12mo');
    expect(manifest.retentionMonths).toBe(18);
    expect(manifest.summary).toEqual({ ok: 1, warn: 1, skip: 1, fail: 0 });
    expect(manifest.items.map((i: { id: string }) => i.id).sort()).toEqual([
      'dependency-scan',
      'list-users-roles',
      'verify-backup',
    ]);

    // Every manifest entry points at a file that exists on disk.
    for (const entry of manifest.items as { file: string }[]) {
      expect(readdirSync(dir)).toContain(entry.file);
    }
  });

  it('a throwing collector is captured as a fail item, not a crash', async () => {
    const dir = evidenceDir(root, '2026-05-25');
    const boom: CollectorSpec = {
      id: 'boom',
      control: 'CCX',
      run: async () => {
        throw new Error('kaboom');
      },
    };
    const items = await collectFrom(dir, [boom], []);
    expect(items[0]?.status).toBe('fail');
    expect(items[0]?.message).toContain('kaboom');
  });
});
