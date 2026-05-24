/**
 * Shared SAML test fixtures (Session 38). A throwaway self-signed cert + a
 * builder that produces a base64 SAML Response with the Assertion signed by
 * node-saml's own signer — so valid fixtures pass node-saml validation by
 * construction, and tweaking one field isolates one broken invariant.
 *
 * NOT a real credential. Used by saml.provider.spec.ts (unit) and the SAML
 * flow integration spec.
 */
import { signSamlPost } from '@node-saml/node-saml/lib/saml-post-signing.js';

export const TEST_SAML_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCbpcpLjE/9yTKB
dV4rh0qF/EfmeZkgfiYrxtNvkHo4k7cTOOAIGsT0YzlDkcgSF4q2bRhLVJwvYuV1
Z5+7kqudbQt/vcClWsbemHNZQt7pYIbeddigJxg1tszEFRdgtt4URU9O1umF5tQI
yi9rTD7Wmhl25BLhLy+AK0wBcJDdiEkN1rZfN17CGbZI0i0BsPF1E8ZSNkytwPp4
gBokVllc4cUrnwbCiAQE37jC0K2q72Ghd+aXhZb96gZq8oq8WEA7Hz+HyFx4a4ur
dQIUkAGcRskjFr5knXM0czXO2lNdIcxwHr2k16RcccKVKr1SdTAI+YPDII2V9AKt
y3yqZjSFAgMBAAECggEABeB4J2sYWBpBLG8si5MzpqR0aIjd1cK9mTiMIjG/06QM
LQ8gMl4kYp/eeSUneztlUucCnFGJBicDR/AOMWxjy3FjFkMpY3TuflgePtgOB5zL
6tljQQTI3rpUt/Cd7dppvzUwvebScWpaRiywJqp90ueFn54T8mmwLvQzjfhcl+iu
2gYGY+WUhvKsIJCU+0VNAR/Cr7v8J3q2RreKgNGzo0do2mFb/iByIlBixhviz8d3
nYRxu9lzhXNvBs+ujgALpnimj5ufhfIMlJ/usx2jkOmYYdrTAQ97w/l3Mgw+sovD
xpX8MnB3sx/QGjx2mtgY88UA7bUm7NRBDm8nbJFk3wKBgQDK0UDeI4h5OHD7102R
f288Zfpz6IEkv5FDSDQJhv+u+xJPzuysoOj+LH+ZUfilATBBIGJ3gdoC+EBeHggx
JvVAnVeGfpRcEoZf1zUruyfsnxKzyjjLs3M+8kPm+iyUtg6jqatWTiRew99j0vvS
Vp0+TPNPXtXbNe6Njpx9cTG3LwKBgQDEdh6EmQC80z8yOFZbsTI2VYZHp3PjIukh
9jnVgSAzaRldEmTTVKGHz1Iy8VGaGqOeaS3tRQiZDMEKZwQtBvhfT4lwfLEd+qgG
xi2Yel+u7NdA6C7QGSN/XxOdtslKSYDkWuHQGEy7u3yRwcM8yPlu4Jmo3EqhngYx
i8oxykSiiwKBgDHvo5EOHqP6CZd4Q1j3j2PHmArBzEpIAHQYaveNjZZ/qtqLkCpQ
1A0A18ngLOAzkrX2S0gxaIQiq3aA3nN7rBbkppAuykiBJySh0C2cPxA7eldaCvHc
lRuCesV8A036JVCWjeEKDFpoz6+8WtRHDyAvwhhguTbn6HxiCJW6MQtxAoGBAL4p
AvMf0enzo4jtpRFNm6eh8r6qo+5n3TbFSUeSm+OHSEihRDyV/2AgWZT7phu+yz7K
2ex+1IqoILX77rvSslg2+XaLCzlUZI1iB8I+OR1tHBE0bBN7MbPZCHiw83dXXE4s
dcRhsOxJ1pKS9XKBqYYcGj+rMwXqml4cy9KT0QlvAoGAAqa9cCUvO/gfVWL07hJ9
2Fr6quIn62+yL+ZZepLDmZwUHYY0AKMlh15tza2a4MLHM+f2ioqKyixUdMd9Ecch
bgtkY+N3i0U1F201MDHBJRi6VSW9OxSHBAWHFITWER6ouk81iK3kUNFeYia1Iqa2
WetEVzNWJBPgo+FaZlZCE6M=
-----END PRIVATE KEY-----`;

export const TEST_SAML_CERT = `-----BEGIN CERTIFICATE-----
MIIDLTCCAhWgAwIBAgIUbVus4wWLZ7suQtOFZdSPRIPj3tIwDQYJKoZIhvcNAQEL
BQAwJjEkMCIGA1UEAwwbdGVzdC1pZHAudXN0b3dkaXNwYXRjaC50ZXN0MB4XDTI2
MDUyNDEwMDU1NloXDTM2MDUyMTEwMDU1NlowJjEkMCIGA1UEAwwbdGVzdC1pZHAu
dXN0b3dkaXNwYXRjaC50ZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEAm6XKS4xP/ckygXVeK4dKhfxH5nmZIH4mK8bTb5B6OJO3EzjgCBrE9GM5Q5HI
EheKtm0YS1ScL2LldWefu5KrnW0Lf73ApVrG3phzWULe6WCG3nXYoCcYNbbMxBUX
YLbeFEVPTtbphebUCMova0w+1poZduQS4S8vgCtMAXCQ3YhJDda2Xzdewhm2SNIt
AbDxdRPGUjZMrcD6eIAaJFZZXOHFK58GwogEBN+4wtCtqu9hoXfml4WW/eoGavKK
vFhAOx8/h8hceGuLq3UCFJABnEbJIxa+ZJ1zNHM1ztpTXSHMcB69pNekXHHClSq9
UnUwCPmDwyCNlfQCrct8qmY0hQIDAQABo1MwUTAdBgNVHQ4EFgQUGLX5NMpHTQ10
wJK5qN4FSJIJEUEwHwYDVR0jBBgwFoAUGLX5NMpHTQ10wJK5qN4FSJIJEUEwDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAXdmAQT4zZZOKqZxHFU+G
kkZIxConifKqiD90Jverg5fQCcdrvw/UaHNHa+RyjAG8/EhSDZT97sXFepU2pgNj
F9P4Q7DLjFw7jmKwsOkpnUQCRPsPjJQE0h5QxcniWFNLtJP6biLLB6SA8cdKLvUZ
h6eeTuaSJ+27yiyHWtszMxgVPXawwceUVl83XBuFkDHMnsV3DVGefMM7JtsPBZEG
gF8pVsaCiyuNOqGUoIpSDZGIHpUc7E5fx5o7J/63B75W47fBYPByMfQBs8T8+UHN
Yd5XwxTI39XOlVbkNWTvf/8KPr7yVcb4IjfJwTXrF1OSJZTpruKRBl/0x0VUNphO
ow==
-----END CERTIFICATE-----`;

const ASSERTION_XPATH =
  '//*[local-name(.)="Assertion" and namespace-uri(.)="urn:oasis:names:tc:SAML:2.0:assertion"]';

export interface SamlFixtureOpts {
  acsUrl: string;
  audience: string;
  issuer: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  notOnOrAfter?: Date;
  notBefore?: Date;
}

/** Build a base64 SAML Response with a signed Assertion. */
export function buildSignedSamlResponse(opts: SamlFixtureOpts): string {
  const now = new Date();
  const iso = (d: Date): string => d.toISOString();
  const notOnOrAfter = opts.notOnOrAfter ?? new Date(now.getTime() + 60 * 60 * 1000);
  const notBefore = opts.notBefore ?? new Date(now.getTime() - 5 * 60 * 1000);
  const email = opts.email ?? 'jane.doe@acme.test';
  const firstName = opts.firstName ?? 'Jane';
  const lastName = opts.lastName ?? 'Doe';

  const xml = `<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp_${now.getTime()}" Version="2.0" IssueInstant="${iso(now)}" Destination="${opts.acsUrl}">
  <saml:Issuer>${opts.issuer}</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assert_${now.getTime()}" Version="2.0" IssueInstant="${iso(now)}">
    <saml:Issuer>${opts.issuer}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="${iso(notOnOrAfter)}" Recipient="${opts.acsUrl}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${iso(notBefore)}" NotOnOrAfter="${iso(notOnOrAfter)}">
      <saml:AudienceRestriction><saml:Audience>${opts.audience}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="_sess1">
      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      <saml:Attribute Name="given_name"><saml:AttributeValue>${firstName}</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="family_name"><saml:AttributeValue>${lastName}</saml:AttributeValue></saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

  const signed = signSamlPost(xml, ASSERTION_XPATH, {
    privateKey: TEST_SAML_KEY,
    publicCert: TEST_SAML_CERT,
    signatureAlgorithm: 'sha256',
  });
  return Buffer.from(signed).toString('base64');
}
