/**
 * Sentry init for the Next.js edge runtime (middleware, edge routes).
 * DSN-gated — inert when SENTRY_DSN is empty. Loaded by instrumentation.ts
 * only on the edge runtime. See sentry.server.config.ts for rationale.
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
 * Sentry Edge-runtime SDK init (R-06). Loaded by src/instrumentation.ts's
 * register() when NEXT_RUNTIME === 'edge' (middleware, edge routes). Mirrors
 * sentry.server.config.ts. No DSN → disabled.
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
