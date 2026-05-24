/**
 * Sentry init for the browser (Phase 0 hardening, Session 17).
 *
 * Next 15 / @sentry/nextjs v10 loads this client instrumentation file
 * automatically. DSN-gated on the PUBLIC DSN (the only one safe to ship to
 * the browser): when NEXT_PUBLIC_SENTRY_DSN is empty the SDK is inert.
 *
 * Session Replay is left off (sample rates 0) to avoid shipping PII-bearing
 * DOM recordings without an explicit decision — consistent with the API's
 * conservative PII posture.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
