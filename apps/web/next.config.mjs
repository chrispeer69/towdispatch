import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: ['@ustowdispatch/shared', '@ustowdispatch/db', '@ustowdispatch/ui'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
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
