/**
 * Sentry init for the Next.js edge runtime (middleware, edge routes), R-06.
 * Loaded by src/instrumentation.ts register() when NEXT_RUNTIME === 'edge'.
 * Mirrors sentry.server.config.ts — reads the server-only SENTRY_DSN_WEB
 * (falling back to the public mirror). No DSN → the SDK is disabled.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN_WEB ?? process.env.NEXT_PUBLIC_SENTRY_DSN_WEB;

Sentry.init({
  ...(dsn ? { dsn } : {}),
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'production',
});
