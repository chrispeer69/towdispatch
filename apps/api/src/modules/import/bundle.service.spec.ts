import { describe, expect, it } from 'vitest';
import { BundleService } from './bundle.service.js';
import type { TowbookMapping } from './types.js';

const MAPPING: TowbookMapping = {
  version: '1.0',
  source: 'towbook',
  files: {
    customers: {
      external_id: ['towbook_id', 'id'],
      name: ['name', 'customer_name'],
    },
  },
  value_maps: {},
};

describe('BundleService.resolveColumnIndex', () => {
  const b = new BundleService();

  it('finds the first alias present in the header map', () => {
    const headerMap = new Map([
      ['towbook_id', 0],
      ['name', 1],
    ]);
    expect(b.resolveColumnIndex(MAPPING, 'customers', 'external_id', headerMap)).toBe(0);
    expect(b.resolveColumnIndex(MAPPING, 'customers', 'name', headerMap)).toBe(1);
  });

  it('falls back to the second alias when the first is missing', () => {
    const headerMap = new Map([
      ['id', 0],
      ['customer_name', 1],
    ]);
    expect(b.resolveColumnIndex(MAPPING, 'customers', 'external_id', headerMap)).toBe(0);
    expect(b.resolveColumnIndex(MAPPING, 'customers', 'name', headerMap)).toBe(1);
  });

  it('returns null when no alias matches', () => {
    const headerMap = new Map([['something_else', 0]]);
    expect(b.resolveColumnIndex(MAPPING, 'customers', 'external_id', headerMap)).toBeNull();
  });

  it('returns null when the file is not in the mapping', () => {
    expect(b.resolveColumnIndex(MAPPING, 'missing', 'external_id', new Map())).toBeNull();
  });
});

describe('BundleService.buildRowGetter', () => {
  const b = new BundleService();

  it('reads canonical fields via the alias map', () => {
    const headerMap = new Map([
      ['towbook_id', 0],
      ['customer_name', 1],
    ]);
    const get = b.buildRowGetter(MAPPING, 'customers', headerMap);
    const row = ['CUST-001', 'Acme'];
    expect(get(row, 'external_id')).toBe('CUST-001');
    expect(get(row, 'name')).toBe('Acme');
  });

  it('caches resolved column indexes across calls', () => {
    const headerMap = new Map([['towbook_id', 0]]);
    const get = b.buildRowGetter(MAPPING, 'customers', headerMap);
    expect(get(['a'], 'external_id')).toBe('a');
    expect(get(['b'], 'external_id')).toBe('b');
  });

  it('returns null when canonical field has no resolvable alias', () => {
    const headerMap = new Map([['unrelated', 0]]);
    const get = b.buildRowGetter(MAPPING, 'customers', headerMap);
    expect(get(['anything'], 'name')).toBeNull();
  });
});
