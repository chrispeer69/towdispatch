import 'reflect-metadata';

try {
  process.loadEnvFile();
} catch {
  // .env not present — tests that need it will skip themselves.
}

// Globally pin NODE_ENV before any application module is loaded. The
// throttle module reads this at module-init time and switches to a
// test-mode policy with effectively-unlimited per-IP counts (several test
// specs run in parallel forks and share Redis, which burns the per-IP
// burst window for any realistic dev limit). Per-email auth limits in
// AuthService still enforce sane caps where they actually matter.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
