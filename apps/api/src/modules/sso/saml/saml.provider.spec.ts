/**
 * SAML assertion validation tests. Fixtures are signed with node-saml's own
 * signer (signSamlPost) + a throwaway self-signed cert (see
 * test/sso-saml-fixtures), so a valid fixture passes by construction and the
 * negative cases isolate exactly one broken invariant (expiry / signature /
 * audience).
 */
import { describe, expect, it } from 'vitest';
import { TEST_SAML_CERT, buildSignedSamlResponse } from '../../../../test/sso-saml-fixtures.js';
import { type SamlConnectionConfig, parseSamlAssertion } from './saml.provider.js';

const ACS_URL = 'https://api.test/sso/acme/saml/acs';
const SP_ENTITY_ID = 'https://api.test/sso/acme/saml';
const IDP_ISSUER = 'https://idp.test/entity';

const cfg: SamlConnectionConfig = {
  ssoUrl: 'https://idp.test/sso',
  idpCert: TEST_SAML_CERT,
  spEntityId: SP_ENTITY_ID,
  acsUrl: ACS_URL,
  audience: SP_ENTITY_ID,
  idpIssuer: IDP_ISSUER,
};

const valid = (): string =>
  buildSignedSamlResponse({ acsUrl: ACS_URL, audience: SP_ENTITY_ID, issuer: IDP_ISSUER });

describe('parseSamlAssertion', () => {
  it('accepts a valid, correctly-signed assertion and returns claims', async () => {
    const result = await parseSamlAssertion(valid(), cfg);
    expect(result.nameId).toBe('jane.doe@acme.test');
    expect(result.issuer).toBe(IDP_ISSUER);
    expect(result.claims.given_name).toBe('Jane');
    expect(result.claims.family_name).toBe('Doe');
  });

  it('rejects an expired assertion', async () => {
    const b64 = buildSignedSamlResponse({
      acsUrl: ACS_URL,
      audience: SP_ENTITY_ID,
      issuer: IDP_ISSUER,
      notBefore: new Date(Date.now() - 2 * 60 * 60 * 1000),
      notOnOrAfter: new Date(Date.now() - 60 * 60 * 1000),
    });
    await expect(parseSamlAssertion(b64, cfg)).rejects.toThrow();
  });

  it('rejects a tampered (bad signature) assertion', async () => {
    const xml = Buffer.from(valid(), 'base64').toString('utf8');
    const tampered = xml.replace('jane.doe@acme.test', 'attacker@evil.test');
    const tamperedB64 = Buffer.from(tampered).toString('base64');
    await expect(parseSamlAssertion(tamperedB64, cfg)).rejects.toThrow();
  });

  it('rejects an assertion for the wrong audience', async () => {
    const b64 = buildSignedSamlResponse({
      acsUrl: ACS_URL,
      audience: 'https://some-other-sp.test',
      issuer: IDP_ISSUER,
    });
    await expect(parseSamlAssertion(b64, cfg)).rejects.toThrow();
  });

  it('rejects a malformed / unsigned response', async () => {
    const unsigned = Buffer.from('<samlp:Response>nope</samlp:Response>').toString('base64');
    await expect(parseSamlAssertion(unsigned, cfg)).rejects.toThrow();
  });
});
