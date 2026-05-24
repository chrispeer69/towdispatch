/**
 * Sentry init for the Next.js server runtime (Phase 0 hardening, Session 17).
 *
 * DSN-gated: when SENTRY_DSN is empty (dev, CI, founder hasn't created the
 * project) Sentry.init is never called, so there are zero network calls and
 * the SDK is fully inert. Mirrors the API's lazy-init posture
 * (apps/api/src/common/observability/sentry.service.ts).
 *
 * Loaded by instrumentation.ts only on the Node.js runtime.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.RELEASE_TAG,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  });
}
 * Sentry Node-runtime SDK init (R-06). Loaded by src/instrumentation.ts's
 * register() when NEXT_RUNTIME === 'nodejs'. Reads the server-only
 * SENTRY_DSN_WEB (falling back to the public mirror). No DSN → disabled.
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
