#!/usr/bin/env node
/**
 * Provisions a fresh tenant + MFA-enrolled user against the live BFF,
 * then prints credentials and the TOTP secret so we can drive a device
 * test that hits the mfa_required branch end-to-end.
 *
 * Run from apps/api so otplib resolves: node scripts/mfa-provision.mjs
 */
import { authenticator } from 'otplib';

const WEB = process.env.MFA_E2E_WEB ?? 'https://web-production-7e5b.up.railway.app';
const slug = `dev-${Math.random().toString(36).slice(2, 8)}`;
const email = `dev-${Math.random().toString(36).slice(2, 8)}@ustowdispatch.dev`;
const password = 'DriverDev1!Long-Enough';

const jar = new Map();
const apply = (h) => {
  for (const raw of h.getSetCookie?.() ?? []) {
    const [p] = raw.split(';');
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    if (v === '' || /Max-Age=0/i.test(raw)) jar.delete(k);
    else jar.set(k, v);
  }
};
const cookies = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function post(path, body) {
  const res = await fetch(`${WEB}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookies() ? { Cookie: cookies() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  apply(res.headers);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return json;
}

authenticator.options = { window: 1, step: 30 };

await post('/api/auth/signup', {
  tenantName: 'Driver Dev',
  tenantSlug: slug,
  ownerName: 'Driver Dev',
  ownerEmail: email,
  password,
});
jar.clear();

const login1 = await post('/api/auth/login', { email, password });
if (login1.status !== 'mfa_setup_required')
  throw new Error(`unexpected: ${JSON.stringify(login1)}`);

const setup = await post('/api/auth/mfa/setup');
const totp1 = authenticator.generate(setup.secret);
const verify = await post('/api/auth/mfa/verify', { totpCode: totp1 });
if (verify.status !== 'authenticated') throw new Error(`verify: ${JSON.stringify(verify)}`);

process.stdout.write(
  `\n✅ MFA-enrolled test account provisioned\n` +
    `  email:    ${email}\n` +
    `  password: ${password}\n` +
    `  tenant:   ${slug}\n` +
    `  secret:   ${setup.secret}\n` +
    `  current:  ${authenticator.generate(setup.secret)}\n` +
    `  recovery: ${setup.recoveryCodes.join(', ')}\n`,
);
