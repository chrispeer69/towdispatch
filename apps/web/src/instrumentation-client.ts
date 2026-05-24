/**
 * Sentry browser SDK init (R-06).
 *
 * @sentry/nextjs v10 loads the client SDK from `instrumentation-client.ts`
 * (the former `sentry.client.config.ts` is deprecated and does not work under
 * Turbopack — see WEB_HARDENING_DECISIONS.md). Next runs this before app code
 * in the browser.
 *
 * The browser can only read NEXT_PUBLIC_* at runtime, so the canonical
 * SENTRY_DSN_WEB is mirrored to NEXT_PUBLIC_SENTRY_DSN_WEB in next.config.mjs.
 * With no DSN the SDK is disabled — never sends events, never throws.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN_WEB;

Sentry.init({
  ...(dsn ? { dsn } : {}),
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  // Never attach IP / cookies / request bodies. PII stays out of telemetry.
  sendDefaultPii: false,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'production',
});

// Instrument App Router client navigations so route changes surface as Sentry
// transactions. Required hook export per @sentry/nextjs v10.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
