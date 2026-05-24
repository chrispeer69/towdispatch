import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

// Canada Expansion (S47): next-intl without i18n routing. Locale is resolved
// per request (cookie → Accept-Language → en-US) in src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
import { buildCsp } from './csp.mjs';
import { assertPublicApiUrl } from './env-guard.mjs';

// R-14: refuse to build a production bundle with no NEXT_PUBLIC_API_URL — it
// would silently fall back to http://localhost:3001 in the browser.
assertPublicApiUrl(process.env);

const isDev = process.env.NODE_ENV === 'development';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: ['@ustowdispatch/shared', '@ustowdispatch/db', '@ustowdispatch/ui'],
  env: {
    // R-06: the browser SDK can only read NEXT_PUBLIC_* at runtime. Mirror the
    // single canonical SENTRY_DSN_WEB so there is one var to set in Railway.
    NEXT_PUBLIC_SENTRY_DSN_WEB: process.env.SENTRY_DSN_WEB ?? '',
  },
  async headers() {
    const headers = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];
    // R-12: emit CSP everywhere except `next dev` — dev's HMR websocket +
    // eval + `upgrade-insecure-requests` would trip an unforgiving policy.
    // `next start` (prod, e2e, Railway) gets the full policy.
    if (!isDev) {
      headers.push({ key: 'Content-Security-Policy', value: buildCsp(process.env) });
    }
    return [{ source: '/:path*', headers }];
  },
};

// Wrap with Sentry. Source-map upload runs ONLY when SENTRY_AUTH_TOKEN is set
// (CI/deploy); a local/tokenless build skips upload and is otherwise
// unaffected. The runtime SDK is DSN-gated in the instrumentation files, so
// this wrapper is a no-op at runtime when SENTRY_DSN is empty.
const hasSentryAuth = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { disable: !hasSentryAuth },
  widenClientFileUpload: true,
  disableLogger: true,
  telemetry: false,
});
export default withNextIntl(nextConfig);
/** @type {import('@sentry/nextjs').SentryBuildOptions} */
const sentryBuildOptions = {
  silent: true,
  // R-06: route the browser SDK's transport through the Next server so
  // ad-blockers (which block sentry.io directly) don't drop error reports.
  tunnelRoute: '/monitoring',
  // Source-map upload needs org/project/token (set in prod CI/CD only).
  // Without a token, skip upload so PR + e2e + local builds stay offline-safe.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT_WEB ? { project: process.env.SENTRY_PROJECT_WEB } : {}),
  ...(process.env.SENTRY_AUTH_TOKEN ? { authToken: process.env.SENTRY_AUTH_TOKEN } : {}),
  widenClientFileUpload: true,
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
