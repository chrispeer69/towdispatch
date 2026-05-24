/**
 * Drift guard — asserts the seed rows in 0051_repo_compliance.sql are exactly
 * the TypeScript config (REPO_STATE_RULES). The migration rows were generated
 * from the config; this test keeps them honest: edit the config without
 * re-generating the migration and CI fails here, not in production.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoStateValues } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { REPO_STATE_RULES } from './state-rules.config';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/modules/repo-compliance → repo root → packages/db/sql/...
const MIGRATION = resolve(here, '../../../../../packages/db/sql/0051_repo_compliance.sql');

function parseSeededRows(sql: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const re = /\('([A-Z]{2})',\s*'(\{.*?\})'::jsonb\)/g;
  let m = re.exec(sql);
  while (m !== null) {
    out[m[1]] = JSON.parse(m[2]);
    m = re.exec(sql);
  }
  return out;
}

describe('0051_repo_compliance.sql — migration ↔ config parity', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const seeded = parseSeededRows(sql);

  it('seeds exactly the 51 jurisdictions in the config', () => {
    expect(Object.keys(seeded).sort()).toEqual([...repoStateValues].sort());
    expect(Object.keys(seeded)).toHaveLength(51);
  });

  it('is INSERT-only-safe and idempotent', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS repo_state_rules');
    expect(sql).toContain('ON CONFLICT (state) DO NOTHING');
  });

  it.each([...repoStateValues])('row %s matches the TS config exactly', (state) => {
    expect(seeded[state]).toEqual(REPO_STATE_RULES[state]);
  });
});
