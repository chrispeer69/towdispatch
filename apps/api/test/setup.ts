import 'reflect-metadata';

try {
  process.loadEnvFile();
} catch {
  // .env not present — tests that need it will skip themselves.
}

// The integration suite signs up ~10 fresh tenants in a single run, well
// past the per-IP 5/60s burst limit on /auth/signup. The throttle guard
// honors this flag only when NODE_ENV=test, so prod is unaffected.
process.env.NODE_ENV = 'test';
process.env.THROTTLE_DISABLE = '1';
