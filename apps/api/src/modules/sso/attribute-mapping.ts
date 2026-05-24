/**
 * Pure claim → user mapping. Both SAML assertion attributes and OIDC
 * id_token claims arrive as a flat `Record<string, unknown>`; this resolves
 * the four user fields we care about (email, firstName, lastName, role)
 * using the connection's configured attribute_mapping, falling back to a
 * set of well-known default claim names when the mapping is silent.
 *
 * Kept pure + dependency-free so it unit-tests trivially and is reused by
 * both providers.
 */
import { ROLE_VALUES, type Role } from '@ustowdispatch/shared';

export interface AttributeMapping {
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  role?: string | undefined;
}

export interface MappedUser {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

// Well-known default claim names, in priority order, per field. Covers the
// common SAML (urn:oid / friendly) and OIDC (snake_case) shapes.
const DEFAULT_EMAIL_CLAIMS = [
  'email',
  'mail',
  'emailAddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
];
const DEFAULT_FIRST_NAME_CLAIMS = [
  'given_name',
  'givenName',
  'firstName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  'urn:oid:2.5.4.42',
];
const DEFAULT_LAST_NAME_CLAIMS = [
  'family_name',
  'surname',
  'sn',
  'lastName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  'urn:oid:2.5.4.4',
];

function readString(claims: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = claims[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    // SAML multi-valued attributes arrive as arrays; take the first string.
    if (Array.isArray(v)) {
      const first = v.find((x) => typeof x === 'string' && x.trim().length > 0);
      if (typeof first === 'string') return first.trim();
    }
  }
  return undefined;
}

const isRole = (v: string): v is Role => (ROLE_VALUES as readonly string[]).includes(v);

/**
 * Resolve the user fields. `nameId` is the SAML NameID / OIDC `sub`, used as
 * the email fallback (many IdPs set NameID to the email). Throws when no
 * email can be resolved — an SSO login with no email is unusable. The role
 * is mapped only if it resolves to a known role; otherwise `defaultRole`.
 */
export function mapClaimsToUser(
  claims: Record<string, unknown>,
  mapping: AttributeMapping,
  opts: { nameId?: string | undefined; defaultRole: Role },
): MappedUser {
  const emailKeys = mapping.email ? [mapping.email, ...DEFAULT_EMAIL_CLAIMS] : DEFAULT_EMAIL_CLAIMS;
  const firstKeys = mapping.firstName
    ? [mapping.firstName, ...DEFAULT_FIRST_NAME_CLAIMS]
    : DEFAULT_FIRST_NAME_CLAIMS;
  const lastKeys = mapping.lastName
    ? [mapping.lastName, ...DEFAULT_LAST_NAME_CLAIMS]
    : DEFAULT_LAST_NAME_CLAIMS;

  let email = readString(claims, emailKeys);
  if (!email && opts.nameId && opts.nameId.includes('@')) email = opts.nameId.trim();
  if (!email) {
    throw new Error('SSO assertion did not yield an email claim');
  }

  const firstName = readString(claims, firstKeys) ?? '';
  const lastName = readString(claims, lastKeys) ?? '';

  let role: Role = opts.defaultRole;
  if (mapping.role) {
    const raw = readString(claims, [mapping.role]);
    if (raw && isRole(raw.toLowerCase())) role = raw.toLowerCase() as Role;
  }

  return { email: email.toLowerCase(), firstName, lastName, role };
}
