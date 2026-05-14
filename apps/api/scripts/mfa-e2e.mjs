#!/usr/bin/env node
/**
 * End-to-end MFA flow check against the live web service. Exercises:
 *   signup → login (mfa_setup_required) → setup → verify (authenticated)
 *   → logout → login (mfa_required) → challenge with TOTP (authenticated)
 *   → logout → login (mfa_required) → challenge with recovery code (authenticated)
 *
 * Talks to https://app.ustowdispatch.cloud (the Next BFF), which in turn calls
 * the api. That tests the cookie bridge + proxy layer too, not just the api.
 *
 * Run: node scripts/mfa-e2e.mjs
 */
import { authenticator } from 'otplib';

const WEB = process.env.MFA_E2E_WEB ?? 'https://app.ustowdispatch.cloud';

const slug = `e2e-${Math.random().toString(36).slice(2, 8)}`;
const email = `e2e-${Math.random().toString(36).slice(2, 8)}@example.test`;
const password = 'TestPass1!Long-Enough';

const jar = new Map();

function applySetCookie(headers) {
  // Node's headers.getSetCookie() returns each Set-Cookie separately.
  // The web BFF uses semi-standard cookies; we ignore Domain and Path nuance
  // because everything is same-origin.
  const all = headers.getSetCookie?.() ?? [];
  for (const raw of all) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === '' || /Max-Age=0/i.test(raw)) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function post(path, body, opts = {}) {
  const res = await fetch(`${WEB}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
      ...(opts.headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  applySetCookie(res.headers);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

function log(...args) {
  process.stdout.write(
    `${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`,
  );
}

async function main() {
  log('▶ web', WEB);
  log('▶ tenant', slug, 'email', email);

  // 1) signup
  let r = await post('/api/auth/signup', {
    tenantName: 'E2E Workspace',
    tenantSlug: slug,
    ownerName: 'E2E Bot',
    ownerEmail: email,
    password,
  });
  log('signup →', r.status, r.json?.status ?? r.json);
  if (!r.ok) throw new Error('signup failed');
  // signup auto-authenticates; log out so we restart at /login like a real user.
  jar.clear();

  // 2) login — expect mfa_setup_required since role=owner and no MFA yet
  r = await post('/api/auth/login', { email, password });
  log('login (1) →', r.status, r.json?.status);
  if (r.json?.status !== 'mfa_setup_required') throw new Error('expected mfa_setup_required');

  // 3) mfa setup
  r = await post('/api/auth/mfa/setup', undefined);
  log(
    'mfa/setup →',
    r.status,
    'secret?',
    Boolean(r.json?.secret),
    'codes',
    r.json?.recoveryCodes?.length,
  );
  if (!r.ok || !r.json?.secret) throw new Error('mfa/setup failed');
  const secret = r.json.secret;
  const recoveryCodes = r.json.recoveryCodes;

  // 4) mfa verify
  authenticator.options = { window: 1, step: 30 };
  const totp1 = authenticator.generate(secret);
  r = await post('/api/auth/mfa/verify', { totpCode: totp1 });
  log('mfa/verify →', r.status, r.json?.status);
  if (r.json?.status !== 'authenticated') throw new Error('mfa/verify did not authenticate');

  // 5) logout
  r = await post('/api/auth/logout', {});
  log('logout →', r.status);
  jar.clear();

  // 6) login (2) — expect mfa_required
  r = await post('/api/auth/login', { email, password });
  log('login (2) →', r.status, r.json?.status);
  if (r.json?.status !== 'mfa_required') throw new Error('expected mfa_required');

  // 7) challenge with TOTP. Re-generate to dodge same-window reuse.
  await new Promise((res) => setTimeout(res, 2000));
  const totp2 = authenticator.generate(secret);
  r = await post('/api/auth/mfa/challenge', { code: totp2 });
  log('mfa/challenge (TOTP) →', r.status, r.json?.status);
  if (r.json?.status !== 'authenticated') throw new Error('TOTP challenge failed');

  // 8) logout + login (3) → recovery code
  await post('/api/auth/logout', {});
  jar.clear();
  r = await post('/api/auth/login', { email, password });
  log('login (3) →', r.status, r.json?.status);
  if (r.json?.status !== 'mfa_required') throw new Error('expected mfa_required (3)');
  const code = recoveryCodes[0];
  r = await post('/api/auth/mfa/challenge', { code });
  log('mfa/challenge (recovery) →', r.status, r.json?.status);
  if (r.json?.status !== 'authenticated') throw new Error('recovery code challenge failed');

  log('✅ end-to-end MFA flow passed on', WEB);
}

main().catch((err) => {
  process.stderr.write(`❌ ${err?.stack ?? err}\n`);
  process.exit(1);
});
