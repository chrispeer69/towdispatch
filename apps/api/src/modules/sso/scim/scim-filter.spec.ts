import { describe, expect, it } from 'vitest';
import { findEqValue, parseScimFilter } from './scim-filter.js';

describe('parseScimFilter', () => {
  it('treats empty / missing filter as supported with no clauses', () => {
    expect(parseScimFilter(undefined)).toEqual({ supported: true, clauses: [] });
    expect(parseScimFilter('')).toEqual({ supported: true, clauses: [] });
    expect(parseScimFilter('   ')).toEqual({ supported: true, clauses: [] });
  });

  it('parses a single quoted-string eq clause', () => {
    const r = parseScimFilter('userName eq "bjensen@example.com"');
    expect(r).toEqual({
      supported: true,
      clauses: [{ attribute: 'userName', value: 'bjensen@example.com' }],
    });
  });

  it('parses externalId eq', () => {
    const r = parseScimFilter('externalId eq "abc-123"');
    expect(findEqValue(r, 'externalId')).toBe('abc-123');
  });

  it('parses boolean and numeric values', () => {
    expect(parseScimFilter('active eq true')).toEqual({
      supported: true,
      clauses: [{ attribute: 'active', value: true }],
    });
    expect(parseScimFilter('count eq 5')).toEqual({
      supported: true,
      clauses: [{ attribute: 'count', value: 5 }],
    });
  });

  it('parses a top-level AND of two eq clauses', () => {
    const r = parseScimFilter('userName eq "x@y.z" and active eq true');
    expect(r.supported).toBe(true);
    if (r.supported) {
      expect(r.clauses).toHaveLength(2);
      expect(findEqValue(r, 'userName')).toBe('x@y.z');
      expect(findEqValue(r, 'active')).toBe(true);
    }
  });

  it('is case-insensitive on the AND keyword', () => {
    const r = parseScimFilter('userName eq "a" AND active eq false');
    expect(r.supported).toBe(true);
  });

  it('reports OR as unsupported', () => {
    const r = parseScimFilter('userName eq "a" or userName eq "b"');
    expect(r.supported).toBe(false);
  });

  it('reports non-eq operators as unsupported', () => {
    expect(parseScimFilter('userName co "jen"').supported).toBe(false);
    expect(parseScimFilter('userName sw "j"').supported).toBe(false);
    expect(parseScimFilter('title pr').supported).toBe(false);
  });

  it('reports grouping / value-path as unsupported', () => {
    expect(parseScimFilter('(userName eq "a")').supported).toBe(false);
    expect(parseScimFilter('emails[type eq "work"]').supported).toBe(false);
  });

  it('unescapes embedded quotes in values', () => {
    const r = parseScimFilter('displayName eq "a \\"quoted\\" name"');
    expect(findEqValue(r, 'displayName')).toBe('a "quoted" name');
  });

  it('findEqValue is attribute-case-insensitive and returns undefined when absent', () => {
    const r = parseScimFilter('userName eq "a@b.c"');
    expect(findEqValue(r, 'USERNAME')).toBe('a@b.c');
    expect(findEqValue(r, 'externalId')).toBeUndefined();
  });
});
