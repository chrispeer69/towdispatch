import { describe, expect, it } from 'vitest';
import { mapClaimsToUser } from './attribute-mapping.js';

describe('mapClaimsToUser', () => {
  const defaults = { defaultRole: 'dispatcher' as const };

  it('resolves email/first/last from default OIDC claim names', () => {
    const out = mapClaimsToUser(
      { email: 'Jane@Example.com', given_name: 'Jane', family_name: 'Doe' },
      {},
      defaults,
    );
    expect(out).toEqual({
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'dispatcher',
    });
  });

  it('honors an explicit attribute mapping over the defaults', () => {
    const out = mapClaimsToUser(
      { 'custom:mail': 'a@b.co', 'custom:first': 'Al', 'custom:last': 'Bo' },
      { email: 'custom:mail', firstName: 'custom:first', lastName: 'custom:last' },
      defaults,
    );
    expect(out.email).toBe('a@b.co');
    expect(out.firstName).toBe('Al');
    expect(out.lastName).toBe('Bo');
  });

  it('falls back to NameID when no email claim is present', () => {
    const out = mapClaimsToUser({ given_name: 'X' }, {}, { ...defaults, nameId: 'who@corp.com' });
    expect(out.email).toBe('who@corp.com');
  });

  it('throws when no email can be resolved', () => {
    expect(() => mapClaimsToUser({ given_name: 'X' }, {}, defaults)).toThrow(/email/i);
    // NameID without an @ is not a usable email.
    expect(() => mapClaimsToUser({}, {}, { ...defaults, nameId: 'opaque-name-id' })).toThrow(
      /email/i,
    );
  });

  it('maps a valid role claim and lowercases it', () => {
    const out = mapClaimsToUser({ email: 'a@b.co', role: 'Admin' }, { role: 'role' }, defaults);
    expect(out.role).toBe('admin');
  });

  it('falls back to defaultRole when the role claim is not a known role', () => {
    const out = mapClaimsToUser({ email: 'a@b.co', role: 'superuser' }, { role: 'role' }, defaults);
    expect(out.role).toBe('dispatcher');
  });

  it('reads the first string from a multi-valued (array) SAML attribute', () => {
    const out = mapClaimsToUser(
      { email: ['first@x.io', 'second@x.io'], given_name: ['Jo'] },
      {},
      defaults,
    );
    expect(out.email).toBe('first@x.io');
    expect(out.firstName).toBe('Jo');
  });

  it('leaves names empty (not throwing) when only email is present', () => {
    const out = mapClaimsToUser({ email: 'a@b.co' }, {}, defaults);
    expect(out.firstName).toBe('');
    expect(out.lastName).toBe('');
  });
});
