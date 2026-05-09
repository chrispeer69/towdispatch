import 'reflect-metadata';

try {
  process.loadEnvFile();
} catch {
  // .env not present — tests that need it will skip themselves.
}
